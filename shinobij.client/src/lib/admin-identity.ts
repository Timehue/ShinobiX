/** Client mirror of the server's full-admin role assignment. */
export function isFullAdminAccountName(name?: string): name is "Admin 1" {
    return name === "Admin 1";
}
