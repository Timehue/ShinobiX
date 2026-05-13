using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 200 * 1024 * 1024; // 200 MB
});

builder.Services.AddHttpClient();

// Add services to the container.
builder.Services.AddControllers();
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

var app = builder.Build();

app.UseDefaultFiles();
app.MapStaticAssets();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.MapPost("/api/generate-image", async (
    GenerateImageRequest request,
    IHttpClientFactory httpClientFactory,
    IConfiguration config
) =>
{
    if (string.IsNullOrWhiteSpace(request.Prompt))
    {
        return Results.BadRequest(new { error = "Missing image prompt." });
    }

    var apiKey =
        config["OpenAI:ApiKey"] ??
        Environment.GetEnvironmentVariable("OPENAI_API_KEY");

    if (string.IsNullOrWhiteSpace(apiKey))
    {
        return Results.Problem("Missing OpenAI API key on the server.");
    }

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

    using var httpRequest = new HttpRequestMessage(
        HttpMethod.Post,
        "https://api.openai.com/v1/images/generations"
    );

    httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
    httpRequest.Content = new StringContent(json, Encoding.UTF8, "application/json");

    var response = await http.SendAsync(httpRequest);
    var responseText = await response.Content.ReadAsStringAsync();

    if (!response.IsSuccessStatusCode)
    {
        return Results.Problem($"OpenAI image generation failed: {responseText}");
    }

    using var doc = JsonDocument.Parse(responseText);

    var b64 = doc.RootElement
        .GetProperty("data")[0]
        .GetProperty("b64_json")
        .GetString();

    if (string.IsNullOrWhiteSpace(b64))
    {
        return Results.Problem("OpenAI did not return image data.");
    }

    return Results.Ok(new
    {
        image = $"data:image/png;base64,{b64}"
    });
});

// ── Village Guard endpoints ───────────────────────────────────────────────
var villageGuards = new System.Collections.Concurrent.ConcurrentDictionary<string, (string name, string village, int level, DateTime lastSeen)>();

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
    villageGuards[name] = (name, village, level, DateTime.UtcNow);
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
        .Where(g => g.village == village && g.lastSeen >= cutoff)
        .Select(g => new { g.name, g.level, g.village })
        .ToList();
    // Prune expired guards
    foreach (var expired in villageGuards.Where(kv => kv.Value.lastSeen < cutoff).Select(kv => kv.Key).ToList())
        villageGuards.TryRemove(expired, out _);
    return Results.Ok(guards);
});
// ──────────────────────────────────────────────────────────────────────────

// ── Player save endpoints ──────────────────────────────────────────────────
var savesDir = Path.Combine(app.Environment.ContentRootPath, "saves");
Directory.CreateDirectory(savesDir);

static string SafeName(string name) =>
    string.Concat(name.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_'))
          .ToLowerInvariant();

app.MapGet("/api/save/{name}", (string name) =>
{
    var path = Path.Combine(savesDir, $"{SafeName(name)}.json");
    if (!File.Exists(path)) return Results.NotFound();
    var json = File.ReadAllText(path);
    return Results.Content(json, "application/json");
});

app.MapPost("/api/save/{name}", async (string name, HttpRequest request) =>
{
    var body = await new StreamReader(request.Body).ReadToEndAsync();
    if (string.IsNullOrWhiteSpace(body)) return Results.BadRequest();
    var path = Path.Combine(savesDir, $"{SafeName(name)}.json");
    await File.WriteAllTextAsync(path, body);
    return Results.Ok();
});
// ──────────────────────────────────────────────────────────────────────────

app.MapFallbackToFile("/index.html");

app.Run();

public record GenerateImageRequest(string Prompt, string Label);