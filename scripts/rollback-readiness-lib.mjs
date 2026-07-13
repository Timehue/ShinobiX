export function stripSqlComments(sql) {
    return String(sql)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\r\n]*/g, ' ');
}

export function destructiveSchemaStatements(sql) {
    const clean = stripSqlComments(sql);
    const patterns = [
        /\bdrop\s+table\b/gi,
        /\balter\s+table\b[\s\S]{0,300}?\bdrop\s+column\b/gi,
        /\btruncate\s+(?:table\s+)?/gi,
    ];
    return patterns.flatMap((pattern) => [...clean.matchAll(pattern)].map((match) => match[0].replace(/\s+/g, ' ').trim()));
}

export function validateRollbackReadiness({ schemaSql, railway, packageJson }) {
    const failures = [];
    const destructive = destructiveSchemaStatements(schemaSql);
    if (destructive.length) failures.push(`destructive schema statements: ${destructive.join(', ')}`);
    if (!/create\s+table\s+if\s+not\s+exists\s+public\.kv_store/i.test(stripSqlComments(schemaSql))) {
        failures.push('kv_store bootstrap must remain idempotent (CREATE TABLE IF NOT EXISTS)');
    }
    if (railway?.deploy?.numReplicas !== 1) failures.push('Railway must remain at one replica until distributed presence and cron leadership are proven');
    if (railway?.deploy?.healthcheckPath !== '/health') failures.push('Railway healthcheckPath must remain /health');
    if (railway?.deploy?.restartPolicyType !== 'ON_FAILURE') failures.push('Railway restart policy must remain ON_FAILURE');
    for (const script of ['drill:restore', 'test:backup']) {
        if (!packageJson?.scripts?.[script]) failures.push(`missing package script ${script}`);
    }
    return { ok: failures.length === 0, failures, destructiveStatements: destructive };
}
