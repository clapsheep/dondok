# CI supplies the tested dist directory, including the versioned PWA shell.
FROM nginx:stable-alpine
RUN mkdir -p /etc/nginx/dondok/server-security /var/cache/nginx /run \
    && chown -R nginx:nginx /etc/nginx/dondok /var/cache/nginx /run /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/api-proxy.conf /etc/nginx/dondok/api-proxy.conf
COPY frontend/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx", "-g", "daemon off;"]
