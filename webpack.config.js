const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  mode: "development",
  entry: "./src/renderer/index.js",
  output: {
    path: path.resolve(__dirname, "dist", "renderer"),
    filename: "bundle.js",
    publicPath: './'
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env", "@babel/preset-react"]
          }
        }
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, "src", "renderer", "index.html"),
    }),
  ],
  devServer: {
    static: {
      directory: path.resolve(__dirname, "dist", "renderer"),
    },
    port: 3000,
  },
  resolve: {
    extensions: [".js", ".jsx"]
  }
};