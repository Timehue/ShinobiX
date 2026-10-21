/** glTF vertex RGB is linear; decoded atlas pixels are sRGB. */
export function petImpostorVertexColor(value, tint = 1, alpha = false) {
    if (tint === 1) return value;
    if (alpha) return value * tint;
    const srgb = value / 255;
    const linear = (srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4) * tint;
    return 255 * (linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055);
}
