"use strict";

module.exports = function eventToPromise(emitter, event, options) {
    const opts = options || {};
    const ignoreErrors = Boolean(opts.ignoreErrors);

    return new Promise((resolve, reject) => {
        const onEvent = (...args) => {
            cleanup();
            if (args.length <= 1) {
                resolve(args[0]);
            } else {
                resolve(args);
            }
        };

        const onError = (error) => {
            cleanup();
            if (ignoreErrors) {
                resolve([error]);
            } else {
                reject(error);
            }
        };

        const cleanup = () => {
            emitter.removeListener(event, onEvent);
            emitter.removeListener("error", onError);
        };

        emitter.once(event, onEvent);
        emitter.once("error", onError);
    });
};
