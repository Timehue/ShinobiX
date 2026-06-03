import { useState } from "react";
import { compressDataUrl } from "../lib/shared-images";

export function AiImagePrompt({
    label,
    suggestedPrompt,
    onImage,
}: {
    label: string;
    suggestedPrompt: string;
    onImage: (image: string) => void;
}) {
    const [prompt, setPrompt] = useState(suggestedPrompt);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState("");

    async function generateImage() {
        const cleanPrompt = prompt.trim();

        if (!cleanPrompt) {
            setError("Type an image prompt first.");
            return;
        }

        try {
            setIsGenerating(true);
            setError("");

            const response = await fetch("/api/generate-image", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    prompt: cleanPrompt,
                    label,
                }),
            });

            const rawText = await response.text();

            let data: { error?: string; detail?: string; title?: string; image?: string } = {};
            try {
                data = rawText ? JSON.parse(rawText) as typeof data : {};
            } catch {
                throw new Error(
                    `Server did not return JSON. Status ${response.status}. Response: ${rawText.slice(0, 300)}`
                );
            }

            if (!response.ok) {
                throw new Error(
                    data.error ||
                    data.detail ||
                    data.title ||
                    `Image generation failed with status ${response.status}.`
                );
            }

            if (!data.image) {
                throw new Error("The server responded, but no image was returned.");
            }

            const compressed = await compressDataUrl(data.image);
            onImage(compressed);
        } catch (err) {
            console.error("Image generation error:", err);
            setError(err instanceof Error ? err.message : "Image generation failed.");
        } finally {
            setIsGenerating(false);
        }
    }

    return (
        <div className="ai-image-generator">
            <label>{label} AI Prompt</label>

            <div className="ai-image-prompt-row">
                <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Small prompt for generated art"
                    disabled={isGenerating}
                />

                <button type="button" onClick={generateImage} disabled={isGenerating}>
                    {isGenerating ? "Generating..." : "Generate"}
                </button>
            </div>

            {error && (
                <p className="hint" style={{ color: "#ff7777", whiteSpace: "pre-wrap" }}>
                    {error}
                </p>
            )}
        </div>
    );
}
