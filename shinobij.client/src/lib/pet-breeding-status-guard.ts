export function shouldApplyBreedingStatus(input: {
    requestNo: number;
    latestRequestNo: number;
    responseVersion: number;
    latestAcceptedVersion: number;
    aborted?: boolean;
}): boolean {
    if (input.aborted || input.requestNo !== input.latestRequestNo) return false;
    return input.responseVersion <= 0 || input.responseVersion >= input.latestAcceptedVersion;
}
