from rest_framework.permissions import BasePermission, SAFE_METHODS
from rest_framework.exceptions import PermissionDenied

def require_claims(mapping):
    """
    Factory that returns a permission class enforcing claim checks.

    Example usage:
        permission_classes = [
            IsAuthenticated,
            require_claims({
                "GET": "camera.read",
                "POST": "camera.write",
                "SAFE_METHODS": "camera.read",     # group mapping
                "UNSAFE_METHODS": "camera.write",  # group mapping
            })
        ]
    """
    class RequireClaims(BasePermission):
        def has_permission(self, request, view):
            user_perms = getattr(request.user, "permissions", [])

            # 1. Try exact HTTP method mapping
            required_perm = mapping.get(request.method)

            # 2. Fallback to SAFE_METHODS or UNSAFE_METHODS
            if not required_perm:
                if request.method in SAFE_METHODS:
                    required_perm = mapping.get("SAFE_METHODS")
                else:
                    required_perm = mapping.get("UNSAFE_METHODS")

            if not required_perm:
                raise PermissionDenied(f"Method {request.method} not allowed")

            if required_perm not in user_perms:
                raise PermissionDenied(f"Missing required claim: {required_perm}")

            return True

    return RequireClaims
