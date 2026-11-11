/** @param {import('@babel/core').ConfigAPI} api */
module.exports = (api) => {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
