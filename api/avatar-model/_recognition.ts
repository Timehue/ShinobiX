export type RecognitionPolicy = {model:string; poolSha256:string};
export type RecognitionOperation = RecognitionPolicy & {nonce:string};
export type RecognitionReceipt = {
    version:1; challengeSha256:string; replySha256:string; target:{assetId:string;version:string;sourceSha256:string};
    correct:number; rounds:8; passed:boolean; responseId:string; model:string;
    usage:{input_tokens:number;output_tokens:number;total_tokens:number};
    masterSha256:string; poolSha256:string; nonce:string;
};
const sha = (value:unknown):value is string => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
export function isRecognitionPolicy(value:unknown):value is RecognitionPolicy {
    const p=value as RecognitionPolicy | null;
    return !!p && typeof p.model==='string' && /^[A-Za-z0-9._-]{1,120}$/.test(p.model) && sha(p.poolSha256);
}

/** Only a private worker receipt for this exact delivered revision can authorize publication. */
export function validRecognition(value:unknown, job:{assetId:string;sourceSha256:string;masterSha256:string;
    delivery?:{version:string};recognition?:RecognitionOperation}, requirePass=true):value is RecognitionReceipt {
    const r=value as RecognitionReceipt | null, op=job.recognition;
    if (!r || !isRecognitionPolicy(op) || !sha(op.nonce) || !job.delivery || r.version!==1 ||
        r.masterSha256!==job.masterSha256 || r.poolSha256!==op.poolSha256 || r.nonce!==op.nonce || r.model!==op.model ||
        r.target?.assetId!==job.assetId || r.target.version!==job.delivery.version || r.target.sourceSha256!==job.sourceSha256 ||
        !sha(r.challengeSha256) || !sha(r.replySha256) || r.rounds!==8 || typeof r.passed!=='boolean' ||
        !Number.isInteger(r.correct) || r.correct<0 || r.correct>8 || (r.passed && r.correct<7) ||
        typeof r.responseId!=='string' || !/^resp_[A-Za-z0-9_-]{1,200}$/.test(r.responseId) || !r.usage) return false;
    const {input_tokens:i,output_tokens:o,total_tokens:t}=r.usage;
    return [i,o,t].every(n=>Number.isSafeInteger(n) && n>=0) && i+o===t && (!requirePass || r.passed);
}
