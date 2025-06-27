"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Something went wrong on the server';
    res.status(statusCode).json({
        success: false,
        message,
    });
};
exports.default = errorHandler;
//# sourceMappingURL=errorHandler.js.map