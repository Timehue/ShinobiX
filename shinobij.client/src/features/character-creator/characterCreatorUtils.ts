import { playerSlug } from "../../lib/utils";
import { playerNamePolicyError, playerPasswordPolicyError } from "../../lib/player-auth-policy";
import type { IdentityErrors } from "./characterCreatorTypes";

export function validateIdentity({ name, password, confirmPassword, requirePassword = true }: {
    name: string;
    password: string;
    confirmPassword: string;
    /**
     * False for a Google or guest signup: those accounts hold no password at
     * all, so there is nothing here to validate and the fields are not shown.
     * The name rules are identical either way — the name IS the account.
     */
    requirePassword?: boolean;
}): IdentityErrors {
    const errors: IdentityErrors = {};

    const nameError = playerNamePolicyError(name);
    if (nameError) {
        errors.name = nameError;
    } else if (!playerSlug(name)) {
        errors.name = "Use at least one letter or number so your save can be found later.";
    }

    if (!requirePassword) return errors;

    errors.password = playerPasswordPolicyError(password) ?? undefined;

    if (password !== confirmPassword) {
        errors.confirmPassword = "Passwords do not match.";
    }

    return errors;
}

export function hasIdentityErrors(errors: IdentityErrors): boolean {
    return Boolean(errors.name || errors.password || errors.confirmPassword);
}
