-- Run once in the Supabase SQL Editor. This script does not insert demo books.
begin;

-- Administrator membership and its read policy.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;

drop policy if exists "Read own admin membership" on public.admin_users;
create policy "Read own admin membership" on public.admin_users
  for select to authenticated using (user_id = (select auth.uid()));

-- Shared authorization helper used by table and Storage policies.
create or replace function public.is_book_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_book_admin() from public;
grant execute on function public.is_book_admin() to anon, authenticated;

-- Book catalog schema and indexes.
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 180),
  subtitle text not null default '',
  author text not null check (char_length(trim(author)) between 1 and 120),
  category text not null check (
    category in ('วรรณกรรม', 'พัฒนาตัวเอง', 'ศิลปะและการออกแบบ', 'ไลฟ์สไตล์', 'ท่องเที่ยว')
  ),
  description text not null check (char_length(trim(description)) between 1 and 6000),
  price numeric(10, 2) not null check (price between 0 and 100000),
  stock integer not null default 0 check (stock between 0 and 100000),
  pages integer not null check (pages between 1 and 10000),
  images jsonb not null default '[]'::jsonb check (
    jsonb_typeof(images) = 'array'
    and jsonb_array_length(images) between 1 and 4
  ),
  publisher text not null default '',
  language text not null default 'ไทย',
  binding text not null default 'ปกอ่อน',
  isbn text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists books_status_created on public.books (status, created_at desc);

-- Visitors read published books; administrators manage the full catalog.
alter table public.books enable row level security;
revoke all on public.books from anon, authenticated;
grant select on public.books to anon;
grant select, insert, update, delete on public.books to authenticated;

drop policy if exists "Read published books or admin drafts" on public.books;
create policy "Read published books or admin drafts" on public.books
  for select to anon, authenticated
  using (status = 'published' or (select public.is_book_admin()));

drop policy if exists "Admins insert books" on public.books;
create policy "Admins insert books" on public.books
  for insert to authenticated
  with check ((select public.is_book_admin()));

drop policy if exists "Admins update books" on public.books;
create policy "Admins update books" on public.books
  for update to authenticated
  using ((select public.is_book_admin()))
  with check ((select public.is_book_admin()));

drop policy if exists "Admins delete books" on public.books;
create policy "Admins delete books" on public.books
  for delete to authenticated
  using ((select public.is_book_admin()));

-- Keep updated_at in sync when an existing book changes.
create or replace function public.touch_book_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists books_updated_at on public.books;
create trigger books_updated_at before update on public.books
  for each row execute function public.touch_book_updated_at();

-- Public book-cover bucket with administrator-only object management.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('book-images', 'book-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Admins read book image objects" on storage.objects;
create policy "Admins read book image objects" on storage.objects
  for select to authenticated
  using (bucket_id = 'book-images' and (select public.is_book_admin()));

drop policy if exists "Admins upload book images" on storage.objects;
create policy "Admins upload book images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'book-images'
    and (select public.is_book_admin())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Admins delete book images" on storage.objects;
create policy "Admins delete book images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'book-images' and (select public.is_book_admin()));

commit;

-- After creating a user in Authentication, run separately with their real UUID:
-- insert into public.admin_users(user_id) values ('REPLACE_WITH_AUTH_USER_UUID');
