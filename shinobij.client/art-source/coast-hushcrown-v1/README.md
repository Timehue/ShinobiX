# Hushcrown Heights painting masters

The ten floor masters in `paintings/floors/` are lossless 1024 × 1024 PNGs registered to the shipped trail centers and building approaches. Use those files as the basis for future edits. The seven room paintings have separate stairs and furnishing positions for each floor. The three entry-scene sheets, two landmark sheets and two ownership standards retain the full raster supplied by the artist.

From this folder, run `node export.cjs "<new output directory>"` with the client dependencies installed. The exporter splits the sheets, clears the alpha matte around the map cutouts, pads them to the game canvas and encodes every candidate to its byte ceiling. It exports 37 Hushcrown WebPs and both 341 × 512 ownership banners.

[Sector guide and painting prompts](../../../output/coast/hushcrown-heights/README.md) · [Ownership banner guide](../../../output/coast/ownership/README.md)

