const serverless = require("serverless-http");
const app = require("../../server");

// Binary responses (screenshots, Excel template) must be base64-encoded by the wrapper.
exports.handler = serverless(app, {
  binary: ["image/*", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
});
