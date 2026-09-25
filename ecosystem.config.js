// language: JavaScript, file: ecosystem.config.js, runtime: Node 18+
// *pm2 يقرأ هذا الملف لتشغيل عدة عمليات — لا تشغّل البوتات يدويًا بعد الآن*

module.exports = {
  apps: [
    {
      name: "whatsapp-bot",
      script: "index.js",
      cwd: "/home/daytona/german-whatsapp-bot",
      interpreter: "node",
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      watch: false,
      max_memory_restart: "800M",
      env: {
        NODE_ENV: "production",
        PORT: 10000,
      },
      out_file: "/home/daytona/logs/whatsapp-out.log",
      error_file: "/home/daytona/logs/whatsapp-error.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "telegram-control",
      script: "telegram_control.py",
      cwd: "/home/daytona",
      interpreter: "python3",
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,
      watch: false,
      out_file: "/home/daytona/logs/telegram-out.log",
      error_file: "/home/daytona/logs/telegram-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};