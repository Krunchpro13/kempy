// Centralised 404 + error handling for the API.
// Keeps responses consistent: always JSON `{ error: <message> }` for /api/*.

// 404 for unmatched API routes (static files are handled before this).
export function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  }
  next();
}

// Final error handler. Express routes that throw or call next(err) land here.
// Logs server-side, returns a safe message to the client.
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  // Log full detail server-side; never leak stack traces to the client.
  console.error(`[error] ${req.method} ${req.path} -> ${status}:`, err.message);
  const message = status >= 500 ? 'Something went wrong. Please try again.' : err.message;
  res.status(status).json({ error: message });
}
