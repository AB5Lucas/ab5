REVOKE EXECUTE ON FUNCTION public.can_access_client(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.move_allocation_service(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.copy_service_split(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_client_service(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_allocation_service(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.copy_service_split(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_client_service(uuid, text) TO authenticated;