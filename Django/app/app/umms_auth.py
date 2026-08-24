import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from django.contrib.auth.models import User


class UMMSJWTAuthentication(BaseAuthentication):
    def authenticate(self, request):
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None  # no token found

        token = auth_header.split(" ")[1]

        try:
            decoded = jwt.decode(
                token,
                settings.UMMS_JWT["SECRET"],
                algorithms=["HS256"],
                audience=settings.UMMS_JWT["AUDIENCE"],
                issuer=settings.UMMS_JWT["ISSUER"],
            )
            # print(decoded)
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed("Token expired")
        except jwt.InvalidTokenError as e:
            raise AuthenticationFailed(f"Invalid token: {str(e)}")


        # Fetch or create local user
        user, _ = User.objects.get_or_create(username=decoded.get("sub", "external_user"))

        # Attach role from MS claim
        user.role = decoded.get("http://schemas.microsoft.com/ws/2008/06/identity/claims/role", "User")
        user.permissions = decoded.get("perm", [])
        return (user, None)