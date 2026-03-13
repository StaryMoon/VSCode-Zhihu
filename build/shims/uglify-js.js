'use strict';

module.exports = {
  minify(input) {
    if (typeof input === 'string') {
      return { code: input };
    }

    if (Array.isArray(input)) {
      return { code: input.join('\n') };
    }

    if (input && typeof input === 'object') {
      return { code: Object.values(input).join('\n') };
    }

    return { code: '' };
  },
};
