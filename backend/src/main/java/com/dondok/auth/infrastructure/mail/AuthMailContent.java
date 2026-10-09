package com.dondok.auth.infrastructure.mail;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.core.io.ClassPathResource;
import org.springframework.web.util.HtmlUtils;

record AuthMailContent(String subject, String text, String html) {
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{(\\w+)}}");
    private static final String TEMPLATE = loadTemplate();

    static AuthMailContent verification(String name, String link) {
        return render(name, link, "이메일을 인증해 주세요", "돈독에 오신 것을 환영해요.",
                "아래 버튼을 눌러 이메일 인증을 완료해 주세요.\n인증 후 함께 쓰는 가계부를 시작할 수 있어요.",
                "이메일 인증하기", "24시간", "가입을 요청하지 않으셨다면 이 메일을 무시해 주세요.");
    }

    static AuthMailContent emailChange(String name, String code) {
        String text = name + "님, 이메일 변경 인증번호는 " + code
                + "입니다. 10분 내 내 계정 화면에 입력하고 현재 비밀번호로 저장해 주세요. 요청하지 않았다면 무시해 주세요.";
        String html = "<html lang=\"ko\"><body style=\"font-family:sans-serif;background:#f5f6f5;padding:24px;color:#222725\">"
                + "<div style=\"max-width:520px;margin:auto;background:white;padding:28px;border-top:4px solid #19463c\">"
                + "<img src=\"cid:dondok-wordmark\" alt=\"돈독\" width=\"132\" height=\"33\">"
                + "<h1>새 이메일을 인증해 주세요</h1><p>" + escape(name) + "님, 아래 인증번호를 내 계정 화면에 입력해 주세요.</p>"
                + "<p style=\"font-size:32px;font-weight:bold;letter-spacing:6px\">" + escape(code) + "</p>"
                + "<p>인증번호는 10분 동안 유효해요. 현재 비밀번호로 저장하면 이메일 변경이 완료돼요.</p>"
                + "<p>요청하지 않으셨다면 무시해 주세요. 기존 이메일은 변경되지 않아요.</p></div></body></html>";
        return new AuthMailContent("[돈독] 이메일 변경 인증번호", text, html);
    }

    static AuthMailContent passwordReset(String name, String link) {
        return render(name, link, "비밀번호를 재설정해 주세요", "비밀번호 재설정을 요청하셨나요?",
                "아래 버튼을 눌러 새 비밀번호를 설정해 주세요.\n다른 곳에서 사용하지 않는 비밀번호를 권장해요.",
                "비밀번호 재설정하기", "30분", "요청하지 않으셨다면 이 메일을 무시해 주세요. 기존 비밀번호는 변경되지 않아요.");
    }

    private static AuthMailContent render(String name, String link, String title, String intro,
            String description, String action, String validity, String notice) {
        Map<String, String> values = Map.of(
                "title", escape(title), "intro", escape(intro), "name", escape(name),
                "description", escape(description).replace("\n", "<br>"),
                "action", escape(action), "validity", validity, "notice", escape(notice), "link", escape(link));
        // Replace once so user text cannot introduce another template placeholder.
        String html = PLACEHOLDER.matcher(TEMPLATE).replaceAll(match -> Matcher.quoteReplacement(values.get(match.group(1))));
        String text = "돈독 — 함께 쓰는 가계부\n\n" + name + "님, " + intro + "\n\n" + description
                + "\n\n" + action + "\n" + link + "\n\n링크는 " + validity + " 동안 한 번만 사용할 수 있어요.\n\n"
                + notice + "\n\n이 메일은 발신 전용이에요.";
        return new AuthMailContent("[돈독] " + title, text, html);
    }

    private static String escape(String value) {
        return HtmlUtils.htmlEscape(value, StandardCharsets.UTF_8.name());
    }

    private static String loadTemplate() {
        try {
            return new ClassPathResource("mail/auth-email.html").getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new UncheckedIOException("Could not load authentication email template", exception);
        }
    }
}
