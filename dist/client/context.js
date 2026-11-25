/** Why `value` doesn't fit `validator` (with where), or null when it does. */
export function mismatch(validator, value, path = 'context') {
    if (value === undefined)
        return validator.isOptional === 'optional' ? null : `${path} is missing`;
    switch (validator.kind) {
        case 'any':
            return null;
        case 'string':
            return typeof value === 'string' ? null : `${path} should be a string`;
        // The table can't be read from an id here, but its shape can: Convex ids are lower-case letters and digits.
        case 'id':
            return typeof value === 'string' && CONVEX_ID.test(value) ? null : `${path} should be a document id`;
        case 'float64':
            return typeof value === 'number' ? null : `${path} should be a number`;
        case 'int64':
            return typeof value === 'bigint' ? null : `${path} should be a bigint`;
        case 'boolean':
            return typeof value === 'boolean' ? null : `${path} should be true or false`;
        case 'null':
            return value === null ? null : `${path} should be null`;
        case 'bytes':
            return value instanceof ArrayBuffer ? null : `${path} should be bytes`;
        case 'literal':
            return value === validator.value ? null : `${path} should be ${JSON.stringify(validator.value)}`;
        case 'array':
            if (!Array.isArray(value))
                return `${path} should be a list`;
            for (let i = 0; i < value.length; i++) {
                const m = mismatch(validator.element, value[i], `${path}[${i}]`);
                if (m)
                    return m;
            }
            return null;
        case 'record': {
            if (!isPlainObject(value))
                return `${path} should be an object`;
            for (const [k, x] of Object.entries(value)) {
                const m = mismatch(validator.key, k, `${path} key`) ?? mismatch(validator.value, x, `${path}.${k}`);
                if (m)
                    return m;
            }
            return null;
        }
        case 'object': {
            if (!isPlainObject(value))
                return `${path} should be an object`;
            const fields = validator.fields;
            for (const [k, f] of Object.entries(fields)) {
                const m = mismatch(f, value[k], `${path}.${k}`);
                if (m)
                    return m;
            }
            const extra = Object.keys(value).find((k) => !(k in fields) && value[k] !== undefined);
            return extra ? `${path}.${extra} isn't expected` : null;
        }
        case 'union': {
            const members = validator.members;
            return members.some((m) => mismatch(m, value, path) === null) ? null : `${path} matches none of the allowed shapes`;
        }
        // Kinds that can't be stored in a checkout's context; Convex checks them anyway when the callback runs.
        case 'commitTs':
        case 'function':
            return null;
    }
    // A kind of validator newer than this check: Convex still validates it when the callback is called.
    return null;
}
const CONVEX_ID = /^[0-9a-z]{20,64}$/;
const isPlainObject = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
//# sourceMappingURL=context.js.map