const messages = require('./messages.js');
const record = require('./record.js');
const storage = require('./storage.js');

module.exports = {
  ...messages,
  ...record,
  ...storage
};
