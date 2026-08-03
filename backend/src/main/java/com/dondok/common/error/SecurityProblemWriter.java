package com.dondok.common.error;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.MDC;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class SecurityProblemWriter {

    private final ObjectMapper objectMapper;

    public SecurityProblemWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void unauthorized(HttpServletRequest request, HttpServletResponse response, Exception exception)
            throws IOException {
        write(request, response, HttpServletResponse.SC_UNAUTHORIZED,
                "Unauthorized", "AUTHENTICATION_REQUIRED", "로그인이 필요합니다.");
    }

    public void forbidden(HttpServletRequest request, HttpServletResponse response, Exception exception)
            throws IOException {
        write(request, response, HttpServletResponse.SC_FORBIDDEN,
                "Forbidden", "ACCESS_DENIED", "요청을 처리할 권한이 없거나 보안 정보가 만료되었습니다.");
    }

    private void write(
            HttpServletRequest request,
            HttpServletResponse response,
            int status,
            String title,
            String errorCode,
            String detail
    ) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("status", status);
        body.put("detail", detail);
        body.put("instance", request.getRequestURI());
        body.put("errorCode", errorCode);
        body.put("correlationId", MDC.get("requestId"));
        body.put("timestamp", Instant.now());
        body.put("fieldErrors", List.of());
        objectMapper.writeValue(response.getOutputStream(), body);
    }
}
