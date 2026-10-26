import type { ApiResponse } from './_vercel.js';
import { apiErrorContract, type Contract } from '../shared/api-contract.js';

/** Validation failures never serialize the offending payload (it may be a save). */
export function contractResponse<T>(res: ApiResponse, success: Contract<T>) {
    return (status: number, body: unknown) => res.status(status).json(
        status >= 400 ? apiErrorContract.parse(body) : success.parse(body),
    );
}
