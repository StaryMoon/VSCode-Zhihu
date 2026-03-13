//@ts-check

'use strict';

const path = require('path');

/**@type {import('webpack').Configuration}*/
const config = {
  target: 'node', // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/

  entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output:  { 


    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    hashFunction: 'sha256',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: [{
    vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
  },
  // {
  //   'uglify-js': 'uglify-js'

  // }
  ],
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js'],
    alias: {
      'uglify-js$': path.resolve(__dirname, 'build/shims/uglify-js.js'),
    },
    fallback: {
      canvas: false,
      bufferutil: false,
      'utf-8-validate': false,
    },
  },
  module: {
    rules: [
      {
        test: /\.test\.ts$/,
          exclude: /node_modules/,
            use: [
              { loader: 'ignore-loader'}
            ]
      },
      {
        test: /\.ts$/,
          exclude: /node_modules/,
            use: [
              {
                loader: 'ts-loader'
              }
            ]
      }
    ]
  }
  
};
module.exports = config;
