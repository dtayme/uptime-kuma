const PERMISSIONS_POLICY = "geolocation=(), camera=(), microphone=(), payment=(), usb=(), fullscreen=(self)";

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
        crossOriginEmbedderPolicy: false,
    };
};

/**
 * Apply Permissions-Policy header (Helmet doesn't set it by default).
 * @returns {(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => void} Express middleware that sets the Permissions-Policy header.
 */
const permissionsPolicyMiddleware = () => (_req, res, next) => {
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    next();
};

module.exports = {
    buildHelmetConfig,
    permissionsPolicyMiddleware,
};
