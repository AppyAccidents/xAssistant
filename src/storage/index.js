const { StorageRepository } = require('./repository.js');
const { migrateLegacyStorage } = require('./migration.js');

module.exports = {
  StorageRepository,
  migrateLegacyStorage
};
