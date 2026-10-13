module.exports = {
  apps: [
    {
      name: "heibuneko.tech",
      cwd: __dirname,
      script: "pnpm",
      args: "start",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
