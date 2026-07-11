import { playerSlug } from "../../lib/utils";
import { playerPasswordPolicyError } from "../../lib/player-auth-policy";
import type { IdentityErrors } from "./characterCreatorTypes";

export function validateIdentity({ name, password, confirmPassword }: {
    name: string;
    password: string;
    confirmPassword: string;
}): IdentityErrors {
    const errors: IdentityErrors = {};

    if (name.trim().length < 3) {
        errors.name = "Pick a shinobi name with at least 3 characters.";
    } else if (!playerSlug(name)) {
        errors.name = "Use at least one letter or number so your save can be found later.";
    }

    errors.password = playerPasswordPolicyError(password) ?? undefined;

    if (password !== confirmPassword) {
        errors.confirmPassword = "Passwords do not match.";
    }

    return errors;
}

export function hasIdentityErrors(errors: IdentityErrors): boolean {
    return Boolean(errors.name || errors.password || errors.confirmPassword);
}
