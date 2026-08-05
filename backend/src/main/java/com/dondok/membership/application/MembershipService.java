package com.dondok.membership.application;

import com.dondok.auth.application.PublicUrlProperties;
import com.dondok.auth.infrastructure.persistence.AppUserEntity;
import com.dondok.auth.infrastructure.persistence.AppUserRepository;
import com.dondok.asset.application.AssetTypeBootstrapService;
import com.dondok.asset.application.DefaultAssetBootstrapService;
import com.dondok.category.application.CategoryService;
import com.dondok.common.error.ApiException;
import com.dondok.common.id.UuidV7;
import com.dondok.common.security.SecretTokenService;
import com.dondok.membership.domain.InvitationStatus;
import com.dondok.membership.domain.LedgerBookStatus;
import com.dondok.membership.infrastructure.persistence.LedgerBookEntity;
import com.dondok.membership.infrastructure.persistence.LedgerBookRepository;
import com.dondok.membership.infrastructure.persistence.LedgerInvitationEntity;
import com.dondok.membership.infrastructure.persistence.LedgerInvitationRedemptionEntity;
import com.dondok.membership.infrastructure.persistence.LedgerInvitationRedemptionRepository;
import com.dondok.membership.infrastructure.persistence.LedgerInvitationRepository;
import com.dondok.membership.infrastructure.persistence.LedgerMemberEntity;
import com.dondok.membership.infrastructure.persistence.LedgerMemberRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MembershipService {

    private static final Duration INVITATION_TTL = Duration.ofDays(7);
    private static final int INVITATION_ISSUE_ATTEMPTS = 32;
    private static final Pattern DIRECT_CODE_PATTERN = Pattern.compile("\\d{6}");
    private static final ZoneId SERVICE_ZONE = ZoneId.of("Asia/Seoul");
    private static final String LEDGER_DELETION_CONFIRMATION = "가계부 삭제";

    private final LedgerBookRepository books;
    private final LedgerMutationGuard mutationGuard;
    private final LedgerMemberRepository members;
    private final LedgerInvitationRepository invitations;
    private final LedgerInvitationRedemptionRepository redemptions;
    private final AppUserRepository users;
    private final SecretTokenService tokenService;
    private final DirectInvitationCodeGenerator directCodeGenerator;
    private final InvitationAttemptLimiter invitationAttemptLimiter;
    private final PublicUrlProperties publicUrlProperties;
    private final EntityManager entityManager;
    private final Clock clock;
    private final AssetTypeBootstrapService assetTypeBootstrapService;
    private final DefaultAssetBootstrapService defaultAssetBootstrapService;
    private final CategoryService categoryService;

    public MembershipService(
            LedgerBookRepository books,
            LedgerMutationGuard mutationGuard,
            LedgerMemberRepository members,
            LedgerInvitationRepository invitations,
            LedgerInvitationRedemptionRepository redemptions,
            AppUserRepository users,
            SecretTokenService tokenService,
            DirectInvitationCodeGenerator directCodeGenerator,
            InvitationAttemptLimiter invitationAttemptLimiter,
            PublicUrlProperties publicUrlProperties,
            EntityManager entityManager,
            Clock clock,
            AssetTypeBootstrapService assetTypeBootstrapService,
            DefaultAssetBootstrapService defaultAssetBootstrapService,
            CategoryService categoryService
    ) {
        this.books = books;
        this.mutationGuard = mutationGuard;
        this.members = members;
        this.invitations = invitations;
        this.redemptions = redemptions;
        this.users = users;
        this.tokenService = tokenService;
        this.directCodeGenerator = directCodeGenerator;
        this.invitationAttemptLimiter = invitationAttemptLimiter;
        this.publicUrlProperties = publicUrlProperties;
        this.entityManager = entityManager;
        this.clock = clock;
        this.assetTypeBootstrapService = assetTypeBootstrapService;
        this.defaultAssetBootstrapService = defaultAssetBootstrapService;
        this.categoryService = categoryService;
    }

    @Transactional(readOnly = true)
    public CurrentLedgerBook currentLedgerBook(UUID userId) {
        return members.findByUserId(userId)
                .map(member -> new CurrentLedgerBook(ledgerBook(member.getBookId(), userId)))
                .orElseGet(() -> new CurrentLedgerBook(null));
    }

    @Transactional
    public LedgerBookView createLedgerBook(UUID userId) {
        AppUserEntity user = lockUser(userId);
        if (members.existsByUserId(userId)) {
            throw userAlreadyHasLedger();
        }

        Instant now = clock.instant();
        LedgerBookEntity book = books.save(new LedgerBookEntity(
                UuidV7.next(), user.getId(), now));
        LedgerMemberEntity creatorMember = members.save(
                new LedgerMemberEntity(UuidV7.next(), book.getId(), userId, now));
        members.flush();
        assetTypeBootstrapService.bootstrap(book.getId(), creatorMember.getId(), now);
        defaultAssetBootstrapService.bootstrap(
                book.getId(),
                creatorMember.getId(),
                LocalDate.ofInstant(now, SERVICE_ZONE),
                now);
        categoryService.bootstrap(book.getId(), creatorMember.getId(), now);
        return ledgerBook(book, userId);
    }

    @Transactional(readOnly = true)
    public List<InvitationSummary> invitations(UUID userId) {
        LedgerMemberEntity member = currentMember(userId);
        Instant now = clock.instant();
        return invitations.findAllByBookIdOrderByCreatedAtDescIdDesc(member.getBookId()).stream()
                .map(invitation -> invitationSummary(invitation, now))
                .toList();
    }

    @Transactional
    public IssuedInvitation issueInvitation(UUID userId) {
        LedgerMutationGuard.LockedLedger lockedLedger = mutationGuard.lockCurrentLedgerExclusively(userId);
        LedgerMemberEntity member = lockedLedger.member();
        Instant now = clock.instant();
        Instant expiresAt = now.plus(INVITATION_TTL);

        for (int attempt = 0; attempt < INVITATION_ISSUE_ATTEMPTS; attempt++) {
            UUID invitationId = UuidV7.next();
            SecretTokenService.IssuedToken linkToken = tokenService.issue();
            String directCode = directCodeGenerator.issue();
            int inserted = invitations.insertIssuedInvitation(
                    invitationId,
                    member.getBookId(),
                    member.getId(),
                    linkToken.digest(),
                    tokenService.digest(directCode),
                    now,
                    expiresAt);
            if (inserted == 0) {
                continue;
            }

            lockedLedger.book().touch(now);
            books.flush();
            return new IssuedInvitation(
                    invitationId,
                    InvitationStatus.ACTIVE,
                    now,
                    expiresAt,
                    directCode,
                    invitationUrl(linkToken.rawToken()));
        }

        throw new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "INVITATION_CODE_UNAVAILABLE",
                "초대 코드를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }

    @Transactional
    public void revokeInvitation(UUID userId, UUID invitationId) {
        LedgerMutationGuard.LockedLedger lockedLedger = mutationGuard.lockCurrentLedgerExclusively(userId);
        LedgerMemberEntity member = lockedLedger.member();
        LedgerInvitationEntity invitation = invitations
                .findByIdAndBookIdForUpdate(invitationId, member.getBookId())
                .orElseThrow(() -> new ApiException(
                        HttpStatus.NOT_FOUND,
                        "INVITATION_NOT_FOUND",
                        "초대를 찾을 수 없습니다."));
        Instant now = clock.instant();
        InvitationStatus status = invitation.statusAt(now);
        if (status == InvitationStatus.EXPIRED) {
            throw invitationExpired();
        }
        if (status != InvitationStatus.ACTIVE) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "INVITATION_NOT_ACTIVE",
                    "이미 사용되었거나 취소된 초대입니다.");
        }
        invitation.revoke(now);
        lockedLedger.book().touch(now);
        books.flush();
    }

    @Transactional(readOnly = true)
    public InvitationPreview previewInvitation(UUID userId, String rawCode) {
        checkDirectCodeAttempt(userId, rawCode);
        LedgerInvitationEntity invitation = findInvitation(rawCode)
                .orElseThrow(this::invalidInvitation);
        requireUsable(invitation, clock.instant());
        if (members.existsByUserId(userId)) {
            throw userAlreadyHasLedger();
        }

        LedgerBookEntity book = activeBook(invitation.getBookId());
        List<LedgerMemberEntity> ledgerMembers = members
                .findAllByBookIdOrderByJoinedAtAscIdAsc(book.getId());
        Map<UUID, AppUserEntity> usersById = users.findAllById(
                        ledgerMembers.stream().map(LedgerMemberEntity::getUserId).toList()).stream()
                .collect(Collectors.toMap(AppUserEntity::getId, Function.identity()));
        List<String> memberNames = ledgerMembers.stream()
                .map(member -> requiredUser(usersById, member.getUserId()).getDisplayName())
                .toList();
        return new InvitationPreview(memberNames, memberNames.size(), invitation.getExpiresAt());
    }

    @Transactional
    public LedgerBookView redeemInvitation(UUID userId, String rawCode) {
        checkDirectCodeAttempt(userId, rawCode);
        lockUser(userId);
        LedgerInvitationRepository.InvitationTarget invitationTarget = findInvitationTarget(rawCode)
                .orElseThrow(this::invalidInvitation);
        LedgerBookEntity book = books.findByIdForUpdate(invitationTarget.getBookId())
                .filter(candidate -> candidate.getStatus() == LedgerBookStatus.ACTIVE)
                .orElseThrow(this::ledgerNotFound);
        LedgerInvitationEntity invitation = invitations
                .findByIdAndBookIdForUpdate(invitationTarget.getInvitationId(), book.getId())
                .orElseThrow(this::invalidInvitation);

        var redemption = redemptions.findByInvitationId(invitation.getId());
        if (redemption.isPresent()) {
            if (redemption.get().getUserId().equals(userId)) {
                return ledgerBook(book, userId);
            }
            throw invitationAlreadyUsed();
        }

        Instant now = clock.instant();
        requireUsable(invitation, now);
        if (members.existsByUserId(userId)) {
            throw userAlreadyHasLedger();
        }

        LedgerMemberEntity member = members.save(new LedgerMemberEntity(
                UuidV7.next(), book.getId(), userId, now));
        members.flush();
        redemptions.save(new LedgerInvitationRedemptionEntity(
                invitation.getId(), invitation.getBookId(), userId, member.getId(), now));
        invitation.redeem(now);
        redemptions.flush();
        book.touch(now);
        books.flush();
        return ledgerBook(book, userId);
    }

    @Transactional
    public void deleteCurrentLedgerBook(UUID userId, DeleteLedgerBookCommand command) {
        if (!LEDGER_DELETION_CONFIRMATION.equals(command.confirmationPhrase())) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "LEDGER_DELETE_CONFIRMATION_INVALID",
                    "가계부 삭제 확인 문구를 정확히 입력해 주세요.");
        }

        LedgerMemberEntity observedMember = currentMember(userId);
        if (!observedMember.getBookId().equals(command.expectedLedgerId())) {
            throw versionConflict();
        }

        LedgerBookEntity book = books.findByIdForUpdate(command.expectedLedgerId())
                .orElseGet(() -> {
                    LedgerMemberEntity latestMember = members.findByUserId(userId).orElse(null);
                    if (latestMember != null
                            && !latestMember.getBookId().equals(command.expectedLedgerId())) {
                        throw versionConflict();
                    }
                    throw ledgerNotFound();
                });
        LedgerMemberEntity currentMember = members.findByUserId(userId).orElseThrow(this::ledgerNotFound);
        if (!currentMember.getBookId().equals(book.getId())) {
            throw versionConflict();
        }
        if (book.getStatus() != LedgerBookStatus.ACTIVE) {
            throw ledgerNotFound();
        }
        if (book.getVersion() != command.expectedVersion()) {
            throw versionConflict();
        }

        books.delete(book);
        books.flush();
    }

    private LedgerBookView ledgerBook(UUID bookId, UUID currentUserId) {
        return ledgerBook(activeBook(bookId), currentUserId);
    }

    private LedgerBookView ledgerBook(LedgerBookEntity book, UUID currentUserId) {
        List<LedgerMemberEntity> ledgerMembers = members
                .findAllByBookIdOrderByJoinedAtAscIdAsc(book.getId());
        Map<UUID, AppUserEntity> usersById = users.findAllById(
                        ledgerMembers.stream().map(LedgerMemberEntity::getUserId).toList()).stream()
                .collect(Collectors.toMap(AppUserEntity::getId, Function.identity()));
        List<LedgerMemberView> memberViews = ledgerMembers.stream()
                .map(member -> {
                    AppUserEntity user = requiredUser(usersById, member.getUserId());
                    return new LedgerMemberView(
                            member.getId(),
                            user.getDisplayName(),
                            member.getJoinedAt(),
                            member.getUserId().equals(currentUserId));
                })
                .sorted(Comparator.comparing(LedgerMemberView::joinedAt).thenComparing(LedgerMemberView::memberId))
                .toList();
        return new LedgerBookView(book.getId(), book.getVersion(), memberViews);
    }

    private LedgerMemberEntity currentMember(UUID userId) {
        return members.findByUserId(userId)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.NOT_FOUND,
                        "LEDGER_NOT_FOUND",
                        "참여 중인 가계부가 없습니다."));
    }

    private LedgerBookEntity activeBook(UUID bookId) {
        LedgerBookEntity book = books.findById(bookId)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.NOT_FOUND,
                        "LEDGER_NOT_FOUND",
                        "가계부를 찾을 수 없습니다."));
        if (book.getStatus() != LedgerBookStatus.ACTIVE) {
            throw new ApiException(
                    HttpStatus.NOT_FOUND,
                    "LEDGER_NOT_FOUND",
                    "가계부를 찾을 수 없습니다.");
        }
        return book;
    }

    private AppUserEntity lockUser(UUID userId) {
        AppUserEntity user = entityManager.find(AppUserEntity.class, userId, LockModeType.PESSIMISTIC_WRITE);
        if (user == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND", "로그인 사용자를 찾을 수 없습니다.");
        }
        return user;
    }

    private AppUserEntity requiredUser(Map<UUID, AppUserEntity> usersById, UUID userId) {
        AppUserEntity user = usersById.get(userId);
        if (user == null) {
            throw new IllegalStateException("ledger member user is missing");
        }
        return user;
    }

    private InvitationSummary invitationSummary(LedgerInvitationEntity invitation, Instant now) {
        return new InvitationSummary(
                invitation.getId(),
                invitation.statusAt(now),
                invitation.getCreatedAt(),
                invitation.getExpiresAt());
    }

    private void requireUsable(LedgerInvitationEntity invitation, Instant now) {
        switch (invitation.statusAt(now)) {
            case ACTIVE -> {
                return;
            }
            case EXPIRED -> throw invitationExpired();
            case REDEEMED -> throw invitationAlreadyUsed();
            case REVOKED -> throw new ApiException(
                    HttpStatus.CONFLICT,
                    "INVITATION_REVOKED",
                    "취소된 초대입니다.");
        }
    }

    private Optional<LedgerInvitationEntity> findInvitation(String rawCode) {
        String digest = tokenService.digest(rawCode);
        if (isDirectCode(rawCode)) {
            return invitations.findByDirectCodeDigest(digest);
        }
        return invitations.findByLinkTokenDigest(digest);
    }

    private Optional<LedgerInvitationRepository.InvitationTarget> findInvitationTarget(String rawCode) {
        String digest = tokenService.digest(rawCode);
        if (isDirectCode(rawCode)) {
            return invitations.findTargetByDirectCodeDigest(digest);
        }
        return invitations.findTargetByLinkTokenDigest(digest);
    }

    private boolean isDirectCode(String rawCode) {
        return DIRECT_CODE_PATTERN.matcher(rawCode).matches();
    }

    private void checkDirectCodeAttempt(UUID userId, String rawCode) {
        if (isDirectCode(rawCode)) {
            invitationAttemptLimiter.check(userId);
        }
    }

    private String invitationUrl(String rawToken) {
        String base = publicUrlProperties.publicUrl();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base + "/join?code=" + URLEncoder.encode(rawToken, StandardCharsets.UTF_8);
    }

    private ApiException invalidInvitation() {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVITATION_INVALID", "유효하지 않은 초대 코드입니다.");
    }

    private ApiException invitationExpired() {
        return new ApiException(HttpStatus.CONFLICT, "INVITATION_EXPIRED", "만료된 초대입니다.");
    }

    private ApiException invitationAlreadyUsed() {
        return new ApiException(HttpStatus.CONFLICT, "INVITATION_ALREADY_USED", "이미 사용된 초대입니다.");
    }

    private ApiException userAlreadyHasLedger() {
        return new ApiException(HttpStatus.CONFLICT, "USER_ALREADY_HAS_LEDGER", "이미 참여 중인 가계부가 있습니다.");
    }

    private ApiException ledgerNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "LEDGER_NOT_FOUND", "참여 중인 가계부가 없습니다.");
    }

    private ApiException versionConflict() {
        return new ApiException(
                HttpStatus.PRECONDITION_FAILED,
                "VERSION_CONFLICT",
                "삭제를 확인하는 동안 가계부가 변경되었습니다.");
    }

    public record CurrentLedgerBook(LedgerBookView ledger) {
    }

    public record DeleteLedgerBookCommand(
            UUID expectedLedgerId,
            long expectedVersion,
            String confirmationPhrase
    ) {
    }

    public record LedgerBookView(UUID ledgerId, long version, List<LedgerMemberView> members) {
    }

    public record LedgerMemberView(UUID memberId, String displayName, Instant joinedAt, boolean currentUser) {
    }

    public record InvitationSummary(
            UUID invitationId,
            InvitationStatus status,
            Instant createdAt,
            Instant expiresAt
    ) {
    }

    public record IssuedInvitation(
            UUID invitationId,
            InvitationStatus status,
            Instant createdAt,
            Instant expiresAt,
            String code,
            String inviteUrl
    ) {
    }

    public record InvitationPreview(
            List<String> memberNames,
            int memberCount,
            Instant expiresAt
    ) {
    }
}
