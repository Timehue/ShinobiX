import type { AdminAccount } from "../types/core";

/**
 * Moved verbatim from App.tsx, which is where both of these used to live — App
 * carried its own duplicate of isFullAdminAccountName alongside this file's
 * copy. lib/jutsu-loadout needs isAdminAccountName, and a lib module reaching
 * back into App is exactly the import that makes everything downstream of it
 * unloadable under node:test.
 */
export function isAdminAccountName(name?: string): name is AdminAccount { return name === "Admin 1" || name === "Admin 2"; }

/** Client mirror of the server's full-admin role assignment. */
export function isFullAdminAccountName(name?: string): name is "Admin 1" {
    return name === "Admin 1";
}
