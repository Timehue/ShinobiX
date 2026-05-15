using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 200 * 1024 * 1024; // 200 MB
});

builder.Services.AddHttpClient();
builder.Services.AddControllers();
builder.Services.AddOpenApi();

// S3 is used in production when AWS_S3_BUCKET is set; file system is used locally.
var s3Bucket = builder.Configuration["AWS:S3Bucket"]
    ?? Environment.GetEnvironmentVariable("AWS_S3_BUCKET");
var useS3 = !string.IsNullOrEmpty(s3Bucket);
if (useS3) builder.Services.AddAWSService<IAmazonS3>();

var app = builder.Build();

app.UseDefaultFiles();
app.MapStaticAssets();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Trust the ALB/reverse-proxy X-Forwarded-* headers in production.
// No-op locally (no proxy sends those headers).
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
});

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

// ── Helpers ───────────────────────────────────────────────────────────────

static string? GetId(JsonNode? node) =>
    node is JsonObject obj && obj.TryGetPropertyValue("id", out var id) ? id?.ToString() : null;

static JsonNode? MergePreservingImages(JsonNode? incoming, JsonNode? existing)
{
    if (incoming is JsonArray inArr)
    {
        var result = new JsonArray();
        var exArr = existing as JsonArray;
        for (int i = 0; i < inArr.Count; i++)
        {
            var item = inArr[i];
            JsonNode? existingItem = null;
            if (exArr != null)
            {
                var itemId = GetId(item);
                existingItem = itemId != null
                    ? exArr.FirstOrDefault(e => GetId(e) == itemId)
                    : null;
                existingItem ??= i < exArr.Count ? exArr[i] : null;
            }
            result.Add(MergePreservingImages(item?.DeepClone(), existingItem));
        }
        return result;
    }

    if (incoming is JsonObject inObj)
    {
        var result = new JsonObject();
        var exObj = existing as JsonObject;
        foreach (var prop in inObj)
        {
            var key = prop.Key;
            var value = prop.Value;

            // Preserve existing base64 image when incoming sends an empty string
            if ((key == "image" || key == "avatarImage")
                && value?.ToString() == ""
                && exObj != null
                && exObj.TryGetPropertyValue(key, out var exImg)
                && exImg?.ToString().StartsWith("data:image") == true)
            {
                result[key] = exImg.DeepClone();
                continue;
            }

            if (value is JsonObject || value is JsonArray)
            {
                JsonNode? exChild = null;
                exObj?.TryGetPropertyValue(key, out exChild);
                result[key] = MergePreservingImages(value.DeepClone(), exChild);
            }
            else
            {
                result[key] = value?.DeepClone();
            }
        }
        return result;
    }

    return incoming?.DeepClone();
}

static string SafeName(string name) =>
    string.Concat(name.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_'))
          .ToLowerInvariant();

// ── Image generation ──────────────────────────────────────────────────────

app.MapPost("/api/generate-image", async (
    GenerateImageRequest request,
    IHttpClientFactory httpClientFactory,
    IConfiguration config
) =>
{
    if (string.IsNullOrWhiteSpace(request.Prompt))
        return Results.BadRequest(new { error = "Missing image prompt." });

    var apiKey =
        config["OpenAI:ApiKey"] ??
        Environment.GetEnvironmentVariable("OPENAI_API_KEY");

    if (string.IsNullOrWhiteSpace(apiKey))
        return Results.Problem("Missing OpenAI API key on the server.");

    var finalPrompt = $"""
Create a polished 2D anime shinobi RPG game asset.

User request:
{request.Prompt}

Asset label:
{request.Label}

Style rules:
- original ninja RPG fantasy style
- clean game asset composition
- dramatic lighting
- no text
- no logos
- no UI
- no watermarks
- high detail
- suitable for a browser RPG
""";

    var payload = new
    {
        model = "gpt-image-1",
        prompt = finalPrompt,
        size = "1024x1024",
        quality = "low",
        n = 1
    };

    var json = JsonSerializer.Serialize(payload);
    var http = httpClientFactory.CreateClient();

    using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/images/generations");
    httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
    httpRequest.Content = new StringContent(json, Encoding.UTF8, "application/json");

    var response = await http.SendAsync(httpRequest);
    var responseText = await response.Content.ReadAsStringAsync();

    if (!response.IsSuccessStatusCode)
        return Results.Problem($"OpenAI image generation failed: {responseText}");

    using var doc = JsonDocument.Parse(responseText);
    var b64 = doc.RootElement.GetProperty("data")[0].GetProperty("b64_json").GetString();

    if (string.IsNullOrWhiteSpace(b64))
        return Results.Problem("OpenAI did not return image data.");

    return Results.Ok(new { image = $"data:image/png;base64,{b64}" });
});

// ── Village Guard ─────────────────────────────────────────────────────────

var villageGuards = new System.Collections.Concurrent.ConcurrentDictionary<string, GuardEntry>();

_ = Task.Run(async () =>
{
    using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
    while (await timer.WaitForNextTickAsync())
    {
        var cutoff = DateTime.UtcNow.AddMinutes(-5);
        foreach (var key in villageGuards.Where(kv => kv.Value.LastSeen < cutoff).Select(kv => kv.Key).ToList())
            villageGuards.TryRemove(key, out _);
    }
});

app.MapPost("/api/village-guard/queue", async (HttpRequest request) =>
{
    var body = await new StreamReader(request.Body).ReadToEndAsync();
    using var doc = JsonDocument.Parse(body);
    var root = doc.RootElement;
    if (!root.TryGetProperty("name", out var nameProp) || !root.TryGetProperty("village", out var villageProp))
        return Results.BadRequest(new { error = "Missing name or village." });
    var name    = nameProp.GetString() ?? "";
    var village = villageProp.GetString() ?? "";
    var level   = root.TryGetProperty("level", out var lvl) ? lvl.GetInt32() : 1;
    villageGuards[name] = new GuardEntry(name, village, level, DateTime.UtcNow);
    return Results.Ok(new { ok = true });
});

app.MapPost("/api/village-guard/dequeue", async (HttpRequest request) =>
{
    var body = await new StreamReader(request.Body).ReadToEndAsync();
    using var doc = JsonDocument.Parse(body);
    var root = doc.RootElement;
    if (!root.TryGetProperty("name", out var nameProp))
        return Results.BadRequest(new { error = "Missing name." });
    villageGuards.TryRemove(nameProp.GetString() ?? "", out _);
    return Results.Ok(new { ok = true });
});

app.MapPost("/api/village-guard/list", async (HttpRequest request) =>
{
    var body = await new StreamReader(request.Body).ReadToEndAsync();
    using var doc = JsonDocument.Parse(body);
    var root = doc.RootElement;
    if (!root.TryGetProperty("village", out var villageProp))
        return Results.BadRequest(new { error = "Missing village." });
    var village = villageProp.GetString() ?? "";
    var cutoff  = DateTime.UtcNow.AddMinutes(-5);
    var guards  = villageGuards.Values
        .Where(g => g.Village == village && g.LastSeen >= cutoff)
        .Select(g => new { name = g.Name, level = g.Level, village = g.Village })
        .ToList();
    return Results.Ok(guards);
});

// ── Multiplayer Presence ──────────────────────────────────────────────────

var playerPresence = new System.Collections.Concurrent.ConcurrentDictionary<string, PresenceEntry>(StringComparer.OrdinalIgnoreCase);

_ = Task.Run(async () =>
{
    using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
    while (await timer.WaitForNextTickAsync())
    {
        var cutoff = DateTime.UtcNow.AddSeconds(-30);
        foreach (var key in playerPresence.Where(kv => kv.Value.LastSeen < cutoff).Select(kv => kv.Key).ToList())
            playerPresence.TryRemove(key, out _);
    }
});

app.MapPost("/api/player/heartbeat", async (HttpRequest request) =>
{
    var body = await new StreamReader(request.Body).ReadToEndAsync();
    using var doc = JsonDocument.Parse(body);
    var root = doc.RootElement;

    if (!root.TryGetProperty("name", out var nameProp))
        return Results.BadRequest(new { error = "Missing name." });

    var name         = nameProp.GetString() ?? "";
    var sector       = root.TryGetProperty("sector", out var sp) ? sp.GetInt32() : 40;
    var characterRaw = root.TryGetProperty("character", out var cp) ? cp.GetRawText() : "null";

    var existing         = playerPresence.GetValueOrDefault(name);
    var pendingAttackerRaw = existing?.PendingAttackerJson;

    playerPresence[name] = new PresenceEntry(name, sector, characterRaw, DateTime.UtcNow, null);

    var sectorMates = playerPresence.Values
        .Where(p => p.Name != name && p.Sector == sector)
        .Select(p =>
        {
            int level = 1; string village = ""; string specialty = "Ninjutsu";
            try
            {
                using var cd = JsonDocument.Parse(p.CharacterJson ?? "null");
                var cr = cd.RootElement;
                if (cr.ValueKind == JsonValueKind.Object)
                {
                    if (cr.TryGetProperty("level",     out var lp)) level     = lp.GetInt32();
                    if (cr.TryGetProperty("village",   out var vp)) village   = vp.GetString() ?? "";
                    if (cr.TryGetProperty("specialty", out var sp2)) specialty = sp2.GetString() ?? "Ninjutsu";
                }
            }
            catch { /* ignore malformed */ }

            // Return character as raw JsonElement so it round-trips correctly
            JsonElement? charEl = null;
            try
            {
                using var cd2 = JsonDocument.Parse(p.CharacterJson ?? "null");
                charEl = cd2.RootElement.Clone();
            }
            catch { }

            return new { name = p.Name, sector = p.Sector, character = charEl, level, village, specialty };
        })
        .ToList();

    JsonElement? pendingAttacker = null;
    if (pendingAttackerRaw != null)
    {
        try
        {
            using var pd = JsonDocument.Parse(pendingAttackerRaw);
            pendingAttacker = pd.RootElement.Clone();
        }
        catch { }
    }

    return Results.Ok(new { sectorMates, pendingAttacker });
});

app.MapPost("/api/player/attack", async (HttpRequest request) =>
{
    var body = await new StreamReader(request.Body).ReadToEndAsync();
    using var doc = JsonDocument.Parse(body);
    var root = doc.RootElement;

    if (!root.TryGetProperty("targetName", out var targetProp))
        return Results.BadRequest(new { error = "Missing targetName." });

    var targetName   = targetProp.GetString() ?? "";
    var attackerJson = root.TryGetProperty("attacker", out var ap) ? ap.GetRawText() : "null";

    if (!playerPresence.TryGetValue(targetName, out var target))
        return Results.NotFound(new { error = "Target not online." });

    playerPresence[targetName] = target with { PendingAttackerJson = attackerJson };
    return Results.Ok(new { ok = true });
});

app.MapPost("/api/player/clear-attack", async (HttpRequest request) =>
{
    var body = await new StreamReader(request.Body).ReadToEndAsync();
    using var doc = JsonDocument.Parse(body);
    var root = doc.RootElement;

    if (!root.TryGetProperty("name", out var nameProp))
        return Results.BadRequest(new { error = "Missing name." });

    var name = nameProp.GetString() ?? "";
    if (playerPresence.TryGetValue(name, out var p))
        playerPresence[name] = p with { PendingAttackerJson = null };

    return Results.Ok(new { ok = true });
});

// ── Saves ─────────────────────────────────────────────────────────────────
// Locally:      reads/writes JSON files from the "saves" folder.
// On AWS:       reads/writes from S3 when AWS_S3_BUCKET env var is set.

var savesDir = Path.Combine(app.Environment.ContentRootPath, "saves");
if (!useS3) Directory.CreateDirectory(savesDir);

// ── S3 helpers (only called when useS3 == true) ───────────────────────────

static async Task<string?> S3Read(IAmazonS3 s3, string bucket, string key)
{
    try
    {
        var resp = await s3.GetObjectAsync(bucket, key);
        using var reader = new StreamReader(resp.ResponseStream);
        return await reader.ReadToEndAsync();
    }
    catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
    {
        return null;
    }
}

static async Task S3Write(IAmazonS3 s3, string bucket, string key, string content)
{
    var req = new PutObjectRequest
    {
        BucketName = bucket,
        Key        = key,
        ContentBody = content,
        ContentType = "application/json",
    };
    await s3.PutObjectAsync(req);
}

static async Task S3Copy(IAmazonS3 s3, string bucket, string srcKey, string dstKey)
{
    await s3.CopyObjectAsync(bucket, srcKey, bucket, dstKey);
}

// ── Clan list ─────────────────────────────────────────────────────────────

app.MapGet("/api/clans/list", async (IServiceProvider sp) =>
{
    if (useS3)
    {
        var s3 = sp.GetRequiredService<IAmazonS3>();
        var listed = await s3.ListObjectsV2Async(new ListObjectsV2Request
        {
            BucketName = s3Bucket,
            Prefix     = "saves/clan-",
        });
        var clans = new List<JsonNode?>();
        foreach (var obj in listed.S3Objects)
        {
            var json = await S3Read(s3, s3Bucket!, obj.Key);
            if (json != null)
                try { clans.Add(JsonNode.Parse(json)); } catch { }
        }
        return Results.Ok(clans);
    }
    else
    {
        var clans = Directory.GetFiles(savesDir, "clan-*.json")
            .Select(file =>
            {
                try { return (JsonNode?)JsonNode.Parse(File.ReadAllText(file)); }
                catch { return null; }
            })
            .Where(c => c != null)
            .ToList();
        return Results.Ok(clans);
    }
});

// ── Load save ─────────────────────────────────────────────────────────────

app.MapGet("/api/save/{name}", async (string name, IServiceProvider sp) =>
{
    var safe = SafeName(name);
    if (useS3)
    {
        var s3   = sp.GetRequiredService<IAmazonS3>();
        var json = await S3Read(s3, s3Bucket!, $"saves/{safe}.json");
        return json is null ? Results.NotFound() : Results.Content(json, "application/json");
    }
    else
    {
        var filePath = Path.Combine(savesDir, $"{safe}.json");
        if (!File.Exists(filePath)) return Results.NotFound();
        return Results.Content(File.ReadAllText(filePath), "application/json");
    }
});

// ── Write save ────────────────────────────────────────────────────────────

app.MapPost("/api/save/{name}", async (string name, HttpRequest request, IServiceProvider sp) =>
{
    var body = await new StreamReader(request.Body).ReadToEndAsync();
    if (string.IsNullOrWhiteSpace(body)) return Results.BadRequest();

    var safe = SafeName(name);

    try
    {
        var incoming = JsonNode.Parse(body);
        JsonNode? payload = incoming;

        if (useS3)
        {
            var s3  = sp.GetRequiredService<IAmazonS3>();
            var key = $"saves/{safe}.json";
            var existingJson = await S3Read(s3, s3Bucket!, key);
            if (existingJson != null)
            {
                try
                {
                    var existing = JsonNode.Parse(existingJson);
                    payload = MergePreservingImages(incoming, existing);
                    await S3Copy(s3, s3Bucket!, key, $"saves/{safe}.bak.json");
                }
                catch { /* corrupt existing — overwrite */ }
            }
            await S3Write(s3, s3Bucket!, key, payload?.ToJsonString() ?? body);
        }
        else
        {
            var filePath = Path.Combine(savesDir, $"{safe}.json");
            if (File.Exists(filePath))
            {
                try
                {
                    var existing = JsonNode.Parse(File.ReadAllText(filePath));
                    payload = MergePreservingImages(incoming, existing);
                    File.Copy(filePath, filePath + ".bak", overwrite: true);
                }
                catch
                {
                    File.Copy(filePath, $"{filePath}.corrupt-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.bak", overwrite: true);
                }
            }
            var tmpPath = filePath + ".tmp";
            await File.WriteAllTextAsync(tmpPath, payload?.ToJsonString() ?? body);
            File.Move(tmpPath, filePath, overwrite: true);
        }

        return Results.Ok();
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message);
    }
});

// ── SPA fallback ──────────────────────────────────────────────────────────

app.MapFallbackToFile("/index.html");

app.Run();

// ── Records ───────────────────────────────────────────────────────────────

public record GenerateImageRequest(string Prompt, string Label);
public record GuardEntry(string Name, string Village, int Level, DateTime LastSeen);
public record PresenceEntry(string Name, int Sector, string CharacterJson, DateTime LastSeen, string? PendingAttackerJson);
