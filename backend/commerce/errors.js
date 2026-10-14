'use strict';
class CommerceError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.name = 'CommerceError'; this.code = code; this.statusCode = statusCode; }
}
const fail = (code, message, statusCode = 400) => { throw new CommerceError(code, message, statusCode); };
module.exports = { CommerceError, fail };
