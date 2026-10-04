<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Role;
use Spatie\Permission\Models\Permission;
use App\Models\User;

class RolesAndPermissionsSeeder extends Seeder
{
    public function run(): void
    {
        // Xóa cache của Spatie để tránh lỗi khi chạy lại Seeder
        app()[\Spatie\Permission\PermissionRegistrar::class]->forgetCachedPermissions();

        // 1. Tạo danh sách các Quyền (Permissions)
        $permissions = [
            'view_dashboard',
            'manage_pos',
            'manage_kds',
            'manage_inventory',
            'manage_products',
            'manage_hr',
            'manage_finance',
            'manage_roles_and_users'
        ];

        foreach ($permissions as $permission) {
            Permission::firstOrCreate(['name' => $permission]);
        }

        // 2. Tạo Vai trò (Roles) và gán Quyền
        
        // Role: Pha chế (Barista)
        $baristaRole = Role::firstOrCreate(['name' => 'barista']);
        $baristaRole->givePermissionTo(['manage_kds']);

        // Role: Thu ngân (Cashier)
        $cashierRole = Role::firstOrCreate(['name' => 'cashier']);
        $cashierRole->givePermissionTo(['manage_pos']);

        // Role: Quản trị viên (Admin)
        $adminRole = Role::firstOrCreate(['name' => 'admin']);
        $adminRole->givePermissionTo(Permission::all()); // Admin có tất cả quyền

        // 3. Gán Role Admin cho một User mặc định (để có tài khoản test)
        $adminUser = User::firstOrCreate([
            'email' => 'admin@cafe.com',
        ], [
            'name' => 'Chủ Quán (Admin)',
            'password' => bcrypt('123456'), 
            // Đã xóa dòng 'role' => 'admin' gây lỗi
        ]);

        // Cấp role của Spatie cho user này
        if (!$adminUser->hasRole('admin')) {
            $adminUser->assignRole('admin');
        }
    }
}