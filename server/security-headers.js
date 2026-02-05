const buildHelmetConfig = (isDev) => {
    const cspDirectives = {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", "https:", "wss:", "ws:"],
        frameAncestors: ["'self'"],
    };

    if (isDev) {
        cspDirectives.scriptSrc.push("'unsafe-eval'");
    }

    return {
        contentSecurityPolicy: {
            directives: cspDirectives,
        },
        referrerPolicy: {
            policy: "strict-origin-when-cross-origin",
        },
        permissionsPolicy: {
            policies: {
                geolocation: [],
                camera: [],
                microphone: [],
                payment: [],
                usb: [],
                fullscreen: ["self"],
            },
        },
        crossOriginEmbedderPolicy: false,
    };
};

module.exports = {
    buildHelmetConfig,
};
