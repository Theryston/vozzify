const appVariants = require('./app-variants.json');

module.exports = (value) => {
  if (value === undefined || value === '') return 'development';
  if (Object.hasOwn(appVariants, value)) return value;
  throw new Error(
    `APP_VARIANT must be development, preview, or production; received ${value}`,
  );
};
