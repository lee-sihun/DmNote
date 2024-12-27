const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  mode: "development",
  entry: {
    main: "./src/renderer/windows/main/index.js",
    overlay: "./src/renderer/windows/overlay/index.js",
  },
  output: {
    path: path.resolve(__dirname, "dist", "renderer"),
    filename: "[name].bundle.js",
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
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader']
      }
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, "src", "renderer", "windows", "main", "index.html"),
      filename: "index.html",
      chunks: ["main"]
    }),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, "src", "renderer", "windows", "overlay", "index.html"),
      filename: "overlay.html",
      chunks: ["overlay"]
    }),
  ],
  devServer: {
    static: {
      directory: path.resolve(__dirname, "dist"),
    },
    port: 3000,
  },
  resolve: {
    extensions: [".js", ".jsx"],
    alias: {
      '@components': path.resolve(__dirname, 'src/renderer/components'),
      '@styles': path.resolve(__dirname, 'src/renderer/styles'),
      '@windows': path.resolve(__dirname, 'src/renderer/windows'),
      '@hooks': path.resolve(__dirname, 'src/renderer/hooks'),
      // '@utils': path.resolve(__dirname, 'src/renderer/utils')
    }
  }
};