<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// Gói 5 (2026-10-05): Cấu hình key/value (quy đổi điểm...).
class Setting extends Model
{
    // Audit 2026-10-23 BM-13: fillable tường minh thay $guarded = []
    protected $fillable = ['key', 'value'];
    protected $primaryKey = 'key';
    public $incrementing = false;
    protected $keyType = 'string';

    public static function get(string $key, $default = null)
    {
        $row = static::find($key);
        return $row ? $row->value : $default;
    }

    public static function set(string $key, $value): void
    {
        static::updateOrCreate(['key' => $key], ['value' => (string) $value]);
    }
}
