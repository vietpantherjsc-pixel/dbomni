<?php

namespace App\Services\Sapo;

// =====================================================================
// Cầu nối Sapo — Phần C (2026-10-21): IMAP client tối thiểu bằng socket.
// Lý do tự viết: hệ thống không có sẵn ext-imap/package IMAP, và nhu cầu chỉ gồm
// LOGIN → SELECT → UID SEARCH → UID FETCH (header/body) → LOGOUT.
// Dùng BODY.PEEK[] để không đánh dấu mail là đã đọc. Hỗ trợ SSL (993) /
// STARTTLS / không mã hóa (143). Mọi lỗi ném SapoImapException mô tả rõ.
// =====================================================================
class SapoImapException extends \Exception
{
}

class SapoImapClient
{
    private $conn = null;
    private int $tagSeq = 0;

    public function __destruct()
    {
        $this->close();
    }

    public function connect(string $host, int $port, string $encryption, int $timeout = 20): void
    {
        $remote = ($encryption === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
        $this->conn = @stream_socket_client(
            $remote,
            $errno,
            $errstr,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $encryption === 'ssl' ? $ctx : null
        );
        if (!$this->conn) {
            throw new SapoImapException("Không kết nối được IMAP {$host}:{$port} — {$errstr} ({$errno})");
        }
        stream_set_timeout($this->conn, $timeout);
        $this->readUntilTag(null); // dòng chào * OK ...

        if ($encryption === 'starttls') {
            $tag = $this->nextTag();
            $this->send("{$tag} STARTTLS");
            $this->readUntilTag($tag);
            if (!stream_socket_enable_crypto($this->conn, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new SapoImapException('Bật STARTTLS thất bại.');
            }
        }
    }

    public function login(string $user, string $password): void
    {
        $tag = $this->nextTag();
        $q = fn($s) => '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $s) . '"';
        $this->send("{$tag} LOGIN {$q($user)} {$q($password)}");
        $this->readUntilTag($tag);
    }

    /** Chọn thư mục, trả về số mail đang có */
    public function selectFolder(string $folder): int
    {
        $tag = $this->nextTag();
        $q = '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $folder) . '"';
        $this->send("{$tag} SELECT {$q}");
        $resp = $this->readUntilTag($tag);
        if (preg_match('/\* (\d+) EXISTS/', $resp, $m)) {
            return (int) $m[1];
        }
        return 0;
    }

    /** @return int[] danh sách UID của mail từ ngày $since đến nay (tăng dần) */
    public function searchUidsSince(\DateTimeInterface $since): array
    {
        $tag = $this->nextTag();
        $this->send("{$tag} UID SEARCH SINCE \"{$since->format('d-M-Y')}\"");
        $resp = $this->readUntilTag($tag);
        if (preg_match('/\* SEARCH([ 0-9]*)/', $resp, $m)) {
            $uids = array_filter(array_map('intval', explode(' ', trim($m[1]))));
            sort($uids);
            return array_values($uids);
        }
        return [];
    }

    /** Lấy phần HEADER của 1 mail (để lọc theo người gửi/tiêu đề trước khi tải body) */
    public function fetchHeader(int $uid): string
    {
        $tag = $this->nextTag();
        $this->send("{$tag} UID FETCH {$uid} (BODY.PEEK[HEADER])");
        $resp = $this->readUntilTag($tag);
        return $this->extractLiteral($resp) ?? $resp;
    }

    /** Lấy toàn bộ nội dung thô của 1 mail (headers + MIME body) */
    public function fetchMessage(int $uid): string
    {
        $tag = $this->nextTag();
        $this->send("{$tag} UID FETCH {$uid} (BODY.PEEK[])");
        $resp = $this->readUntilTag($tag);
        return $this->extractLiteral($resp) ?? $resp;
    }

    public function logout(): void
    {
        if ($this->conn) {
            try {
                $tag = $this->nextTag();
                $this->send("{$tag} LOGOUT");
                $this->readUntilTag($tag);
            } catch (\Throwable $e) {
                // bỏ qua lỗi khi đóng kết nối
            }
        }
        $this->close();
    }

    public function close(): void
    {
        if ($this->conn) {
            fclose($this->conn);
            $this->conn = null;
        }
    }

    // ---------- nội bộ ----------

    private function nextTag(): string
    {
        return 'a' . (++$this->tagSeq);
    }

    private function send(string $line): void
    {
        if (fwrite($this->conn, $line . "\r\n") === false) {
            throw new SapoImapException('Gửi lệnh IMAP thất bại.');
        }
    }

    /**
     * Đọc phản hồi cho tới dòng tagged ($tag OK/NO/BAD). $tag = null: đọc 1 dòng chào.
     * Tự xử lý literal {n}: đọc đúng n byte nội dung sau dòng chứa {n}.
     */
    private function readUntilTag(?string $tag): string
    {
        $buffer = '';
        while (true) {
            $line = fgets($this->conn);
            if ($line === false) {
                $meta = stream_get_meta_data($this->conn);
                if (!empty($meta['timed_out'])) {
                    throw new SapoImapException('IMAP timeout khi chờ phản hồi.');
                }
                throw new SapoImapException('Kết nối IMAP bị đóng bất ngờ.');
            }
            $buffer .= $line;

            // Literal: dòng kết thúc bằng {n} → đọc tiếp đúng n byte
            if (preg_match('/\{(\d+)\}$/', trim($line), $m)) {
                $len = (int) $m[1];
                $read = 0;
                while ($read < $len) {
                    $chunk = fread($this->conn, min(8192, $len - $read));
                    if ($chunk === false || $chunk === '') {
                        throw new SapoImapException('Đọc nội dung mail từ IMAP thất bại.');
                    }
                    $buffer .= $chunk;
                    $read += strlen($chunk);
                }
                continue;
            }

            if ($tag === null) {
                if (str_starts_with($line, '* OK')) {
                    return $buffer;
                }
                if (str_starts_with($line, '* BYE') || str_starts_with($line, '* PREAUTH')) {
                    return $buffer;
                }
                continue;
            }

            if (str_starts_with($line, $tag . ' ')) {
                if (str_contains($line, ' OK')) {
                    return $buffer;
                }
                throw new SapoImapException('IMAP từ chối lệnh: ' . trim($line));
            }
        }
    }

    /** Trích phần literal {n} đầu tiên trong phản hồi FETCH (= nội dung mail) */
    private function extractLiteral(string $resp): ?string
    {
        if (preg_match('/\{\d+\}\r\n/', $resp, $m, PREG_OFFSET_CAPTURE)) {
            $start = $m[0][1] + strlen($m[0][0]);
            preg_match('/\{(\d+)\}\r\n/', $m[0][0], $mm);
            $len = (int) $mm[1];
            return substr($resp, $start, $len);
        }
        return null;
    }
}
