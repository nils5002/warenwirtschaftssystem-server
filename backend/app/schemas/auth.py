from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


AppRole = Literal["Admin", "Projektmanager", "Mitarbeiter"]


class AuthLoginRequest(BaseModel):
    email: str = Field(..., min_length=3, description="E-Mail")
    password: str = Field(..., min_length=1, description="Klartext-Passwort")


class AuthUserInfo(BaseModel):
    userId: str
    name: str
    email: str
    role: AppRole


class AuthLoginResponse(BaseModel):
    accessToken: str
    tokenType: Literal["bearer"] = "bearer"
    expiresIn: int
    user: AuthUserInfo


class AuthRegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)


class AuthRegisterResponse(BaseModel):
    message: str
