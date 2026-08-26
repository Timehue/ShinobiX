import catalog from "./guides-content.json";
import { parseGuideCatalog } from "./guide-schema";

export * from "./guide-schema";

// Tests and editorial tooling use the synchronous catalog. The live guide
// library requests the same JSON as a separate asset so this long-form copy
// does not inflate the application's JavaScript bundle.
export const GUIDES = parseGuideCatalog(catalog);
