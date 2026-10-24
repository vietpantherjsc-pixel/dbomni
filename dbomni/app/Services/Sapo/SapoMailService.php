<?php

namespace App\Services\Sapo;

use App\Models\SapoBranchMap;
use App\Models\SapoMailLog;
use App\Models\Setting;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Log;

// =====================================================================
// Cầu nối Sapo — Phần C (2026-10-21): đọc hộp mail chung qua IMAP.
// - 1 hộp mail cho mọi chi nhánh (Cách B). Chi nhánh nhận diện qua ANCHOR TEXT
//   của link tải trong thân mail (bảng sapo_branch_map); không khớp → dừng
//   file đó + cảnh báo trong sapo_mail_logs, KHÔNG import đoán.
// - Mail hợp lệ → tải xlsx → đẩy qua SapoImportService (pipeline Phần A).
// - Link hiệu lực 7 ngày: mail quá 7 ngày → cảnh báo "hết hạn, xuất lại tay".
// - Chạy lịch mà không thấy mail nào → cảnh báo no_mail cho quản lý.
// - Mật khẩu IMAP lưu trong settings dạng Crypt (APP_KEY), không trả ra API, không log.
// =====================================================================
class SapoMailService
{
    /** Trạng thái đã xử lý xong (không quét lại) — 'error' được phép thử lại lần sau */
    private const DONE_STATUSES = ['imported', 'anchor_unmatched', 'expired', 'no_link'];

    public function __construct(private SapoImportService $importer)
    {
    }

    // ---------------- Cấu hình ----------------

    /** Đọc cấu hình IMAP (kèm mật khẩu đã giải mã — CHỈ dùng nội bộ, không trả ra API) */
    public static function config(bool $withPassword = false): array
    {
        $enc = null;
        try {
            $enc = Crypt::decryptString((string) Setting::get('sapo_imap_password_enc', ''));
        } catch (\Throwable $e) {
            $enc = null;
        }
        return [
            'host' => (string) Setting::get('sapo_imap_host', ''),
            'port' => (int) Setting::get('sapo_imap_port', 993),
            'encryption' => (string) Setting::get('sapo_imap_encryption', 'ssl'),
            'user' => (string) Setting::get('sapo_imap_user', ''),
            'folder' => (string) Setting::get('sapo_imap_folder', 'INBOX'),
            'password_set' => $enc !== null && $enc !== '',
            'password' => $withPassword ? (string) $enc : null,
        ];
    }

    public static function saveConfig(array $data, ?string $plainPassword): void
    {
        Setting::set('sapo_imap_host', trim((string) $data['host']));
        Setting::set('sapo_imap_port', (string) (int) $data['port']);
        Setting::set('sapo_imap_encryption', (string) $data['encryption']);
        Setting::set('sapo_imap_user', trim((string) $data['user']));
        Setting::set('sapo_imap_folder', trim((string) ($data['folder'] ?? 'INBOX')) ?: 'INBOX');
        if ($plainPassword !== null && $plainPassword !== '') {
            Setting::set('sapo_imap_password_enc', Crypt::encryptString($plainPassword));
        }
    }

    // ---------------- Kiểm tra mail ----------------

    /**
     * Quét hộp thư 1 lượt.
     * @return array{scanned: int, candidates: int, imported: int, anchor_unmatched: int, expired: int, no_link: int, errors: int, error?: string}
     */
    public function check(bool $scheduled): array
    {
        $summary = ['scanned' => 0, 'candidates' => 0, 'imported' => 0, 'anchor_unmatched' => 0, 'expired' => 0, 'no_link' => 0, 'errors' => 0];
        $cfg = self::config(true);
        if ($cfg['host'] === '' || $cfg['user'] === '' || empty($cfg['password'])) {
            $msg = 'Chưa cấu hình hộp thư IMAP (host/user/mật khẩu) trong trang Cầu nối Sapo → Cấu hình.';
            if ($scheduled) {
                $this->warn('error', $msg);
            }
            return $summary + ['error' => $msg];
        }

        $senderPattern = SapoText::normalize((string) Setting::get('sapo_mail_sender_pattern', 'sapo'));
        $subjectPattern = SapoText::normalize((string) Setting::get('sapo_mail_subject_pattern', 'xuất file'));
        $branchMap = SapoBranchMap::whereNotNull('branch_id')->pluck('branch_id', 'anchor_text')->all();
        $folder = $cfg['folder'];

        $client = new SapoImapClient();
        try {
            $client->connect($cfg['host'], $cfg['port'], $cfg['encryption']);
            $client->login($cfg['user'], (string) $cfg['password']);
            $client->selectFolder($folder);

            $uids = $client->searchUidsSince(now()->subDays(14));
            $uids = array_slice($uids, -100); // tối đa 100 mail gần nhất mỗi lượt
            foreach ($uids as $uid) {
                $summary['scanned']++;
                $uidKey = $folder . ':' . $uid;
                $seen = SapoMailLog::where('message_uid', $uidKey)->first();
                if ($seen && in_array($seen->status, self::DONE_STATUSES, true)) {
                    continue;
                }

                $headers = $this->parseHeaders($client->fetchHeader($uid));
                if (!$this->matchesPatterns($headers, $senderPattern, $subjectPattern)) {
                    continue; // không phải mail xuất file Sapo → bỏ qua lặng lẽ
                }
                $summary['candidates']++;

                $receivedAt = null;
                if (!empty($headers['date'])) {
                    try {
                        $receivedAt = Carbon::parse($headers['date']);
                    } catch (\Throwable $e) {
                        $receivedAt = null;
                    }
                }

                // Link tải chỉ sống 7 ngày — mail cũ hơn → cảnh báo, không tải nữa
                if ($receivedAt && $receivedAt->lt(now()->subDays(7))) {
                    $this->logMail($uidKey, $headers, null, 'expired',
                        'Mail đã quá 7 ngày — link tải đã hết hạn. Hãy xuất lại file trên Sapo.', $receivedAt, $seen);
                    $summary['expired']++;
                    continue;
                }

                $raw = $client->fetchMessage($uid);
                $html = $this->extractHtmlBody($raw);
                $anchors = $this->extractAnchors($html);

                // Nhận diện chi nhánh qua anchor text của link tải
                $branchId = null;
                $downloadUrl = null;
                $fileLikeUrl = null;
                foreach ($anchors as $a) {
                    $key = SapoText::normalize($a['text']);
                    if ($key !== '' && isset($branchMap[$key])) {
                        if ($this->looksLikeFileLink($a['href'])) {
                            $branchId = (int) $branchMap[$key];
                            $downloadUrl = $a['href'];
                            break;
                        }
                        $fileLikeUrl = $fileLikeUrl ?? $a['href'];
                        $branchId = $branchId ?? (int) $branchMap[$key];
                    }
                }
                $downloadUrl = $downloadUrl ?? $fileLikeUrl;

                if ($branchId === null) {
                    $texts = array_unique(array_map(fn($a) => $a['text'], $anchors));
                    $this->logMail($uidKey, $headers, null, 'anchor_unmatched',
                        'Anchor text của link tải không khớp bảng map chi nhánh. Các anchor thấy trong mail: '
                        . (implode(' | ', array_slice($texts, 0, 10)) ?: '(không có link nào)')
                        . '. Đã dừng file này — bổ sung map anchor → chi nhánh rồi kiểm tra lại.', $receivedAt, $seen);
                    $summary['anchor_unmatched']++;
                    continue;
                }
                if ($downloadUrl === null || $downloadUrl === '') {
                    $this->logMail($uidKey, $headers, $branchId, 'no_link',
                        'Anchor khớp chi nhánh nhưng không có link tải hợp lệ trong mail.', $receivedAt, $seen);
                    $summary['no_link']++;
                    continue;
                }

                // Tải file → import qua pipeline Phần A
                [$content, $httpCode] = $this->download($downloadUrl);
                if ($content === null || strlen($content) < 100) {
                    $this->logMail($uidKey, $headers, $branchId, 'error',
                        'Tải file từ link trong mail thất bại (HTTP ' . $httpCode . '). Có thể link đã hết hạn — hãy xuất lại file trên Sapo.', $receivedAt, $seen);
                    $summary['errors']++;
                    continue;
                }
                $tmp = tempnam(sys_get_temp_dir(), 'sapo_') . '.xlsx';
                file_put_contents($tmp, $content);
                try {
                    $filename = basename((string) parse_url($downloadUrl, PHP_URL_PATH));
                    if (!preg_match('/\.xlsx?$/i', $filename)) {
                        $filename = 'sapo-export-' . now()->format('Ymd-His') . '.xlsx';
                    }
                    $run = $this->importer->importFile($tmp, $filename, $branchId, 'imap');
                } finally {
                    @unlink($tmp);
                }

                if ($run->status === 'error') {
                    $this->logMail($uidKey, $headers, $branchId, 'error', 'Import thất bại: ' . $run->error, $receivedAt, $seen);
                    $summary['errors']++;
                } else {
                    $this->logMail($uidKey, $headers, $branchId, 'imported',
                        'Đã import: tạo mới ' . $run->created_count . ' đơn, trùng ' . $run->duplicate_count
                        . ', kênh DBOMNI ' . $run->dbomni_skipped_count . ', nghi ngờ ' . $run->suspect_count . '.',
                        $receivedAt, $seen, $run->id);
                    $summary['imported']++;
                }
            }
        } catch (SapoImapException $e) {
            Log::error('Sapo IMAP: ' . $e->getMessage());
            if ($scheduled) {
                $this->warn('error', 'Lỗi đọc hộp thư: ' . $e->getMessage());
            }
            return $summary + ['error' => $e->getMessage()];
        } finally {
            $client->logout();
        }

        // Chạy theo lịch mà không thấy mail xuất file nào → cảnh báo quản lý
        if ($scheduled && $summary['candidates'] === 0) {
            $this->warn('no_mail', 'Chưa thấy mail xuất file Sapo trong khung giờ này — kiểm tra nhân viên đã bấm "Xuất file" trên Sapo chưa.');
        }

        return $summary;
    }

    // ---------------- nội bộ ----------------

    private function matchesPatterns(array $headers, string $senderPattern, string $subjectPattern): bool
    {
        if ($senderPattern !== '') {
            $from = SapoText::normalize(($headers['from'] ?? '') . ' ' . ($headers['from_name'] ?? ''));
            if (!str_contains($from, $senderPattern)) {
                return false;
            }
        }
        if ($subjectPattern !== '') {
            $subject = SapoText::normalize($headers['subject'] ?? '');
            if (!str_contains($subject, $subjectPattern)) {
                return false;
            }
        }
        return true;
    }

    private function looksLikeFileLink(string $href): bool
    {
        $h = mb_strtolower($href);
        return str_contains($h, '.xlsx') || str_contains($h, '.xls')
            || str_contains($h, 'download') || str_contains($h, 'export');
    }

    /** @return array{0: ?string, 1: int} [nội dung file, HTTP code] */
    private function download(string $url): array
    {
        $ctx = stream_context_create([
            'http' => ['timeout' => 30, 'user_agent' => 'Mozilla/5.0 (DBOMNI Sapo Import)', 'follow_location' => 1],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $content = @file_get_contents($url, false, $ctx);
        $code = 0;
        if (isset($http_response_header) && is_array($http_response_header)) {
            foreach ($http_response_header as $h) {
                if (preg_match('#^HTTP/\S+ (\d{3})#', $h, $m)) {
                    $code = (int) $m[1]; // lấy trạng thái cuối sau redirect
                }
            }
        }
        if ($content === false || ($code !== 0 && $code >= 400)) {
            return [null, $code];
        }
        return [$content, $code];
    }

    private function logMail(string $uidKey, array $headers, ?int $branchId, string $status, string $detail, ?Carbon $receivedAt, ?SapoMailLog $seen, ?int $runId = null): void
    {
        $data = [
            'subject' => mb_substr((string) ($headers['subject'] ?? ''), 0, 255) ?: null,
            'sender' => mb_substr((string) ($headers['from'] ?? ''), 0, 255) ?: null,
            'branch_id' => $branchId,
            'status' => $status,
            'detail' => $detail,
            'run_id' => $runId,
            'received_at' => $receivedAt,
        ];
        if ($seen) {
            $seen->update($data);
        } else {
            SapoMailLog::create($data + ['message_uid' => $uidKey]);
        }
    }

    /** Cảnh báo vận hành không gắn với 1 mail cụ thể (theo khung giờ chạy lịch) */
    private function warn(string $status, string $detail): void
    {
        SapoMailLog::updateOrCreate(
            ['message_uid' => 'slot-' . now()->format('Ymd-Hi')],
            ['status' => $status, 'detail' => $detail, 'subject' => null, 'sender' => null]
        );
    }

    /** Parse khối header của 1 mail (hỗ trợ header gập dòng + MIME encoded-word) */
    public function parseHeaders(string $raw): array
    {
        $pos = strpos($raw, "\r\n\r\n");
        $head = $pos !== false ? substr($raw, 0, $pos) : $raw;
        $head = preg_replace("/\r\n[ \t]+/", ' ', $head) ?? $head; // unfold
        $out = [];
        foreach (preg_split('/\r\n|\n/', $head) as $line) {
            if (!str_contains($line, ':')) {
                continue;
            }
            [$k, $v] = explode(':', $line, 2);
            $k = mb_strtolower(trim($k));
            $v = trim($v);
            if ($k === 'subject') {
                $out['subject'] = mb_decode_mimeheader($v);
            } elseif ($k === 'from') {
                $out['from'] = mb_decode_mimeheader($v);
                if (preg_match('/<([^>]+)>/', $v, $m)) {
                    $out['from'] = $m[1];
                    $out['from_name'] = mb_decode_mimeheader(trim(str_replace('<' . $m[1] . '>', '', $v), ' "'));
                }
            } elseif ($k === 'date') {
                $out['date'] = $v;
            }
        }
        return $out;
    }

    /** Trích phần HTML từ mail thô (multipart hoặc đơn phần), đã giải mã transfer-encoding */
    public function extractHtmlBody(string $raw): string
    {
        $pos = strpos($raw, "\r\n\r\n");
        if ($pos === false) {
            return '';
        }
        $head = substr($raw, 0, $pos);
        $body = substr($raw, $pos + 4);

        if (preg_match('/boundary="([^"]+)"/i', $head, $m) || preg_match('/boundary=([^\s;]+)/i', $head, $m)) {
            $parts = preg_split('/--' . preg_quote($m[1], '/') . '(--)?(\r\n|\n)/', $body) ?: [];
            foreach ($parts as $part) {
                $p = strpos($part, "\r\n\r\n");
                if ($p === false) {
                    continue;
                }
                $pHead = substr($part, 0, $p);
                if (preg_match('/Content-Type:\s*text\/html/i', $pHead)) {
                    return $this->decodePart(substr($part, $p + 4), $pHead);
                }
            }
            return '';
        }
        return $this->decodePart($body, $head);
    }

    private function decodePart(string $content, string $partHead): string
    {
        if (preg_match('/Content-Transfer-Encoding:\s*base64/i', $partHead)) {
            $decoded = base64_decode(preg_replace('/\s+/', '', $content) ?? '');
            return $decoded !== false ? $decoded : '';
        }
        if (preg_match('/Content-Transfer-Encoding:\s*quoted-printable/i', $partHead)) {
            return quoted_printable_decode($content);
        }
        return $content;
    }

    /** @return array<int, array{href: string, text: string}> mọi thẻ <a> trong HTML */
    public function extractAnchors(string $html): array
    {
        $out = [];
        if (preg_match_all('/<a\b[^>]*\bhref\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)<\/a>/is', $html, $mm, PREG_SET_ORDER)) {
            foreach ($mm as $a) {
                $text = trim(preg_replace('/\s+/', ' ', strip_tags(html_entity_decode($a[2], ENT_QUOTES, 'UTF-8'))) ?? '');
                $out[] = ['href' => html_entity_decode($a[1], ENT_QUOTES, 'UTF-8'), 'text' => $text];
            }
        }
        return $out;
    }
}
