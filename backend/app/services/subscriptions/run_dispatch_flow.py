from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class SubscriptionRunDispatchDependencies:
    process_subscription: Callable[[Any], Awaitable[None]]


async def dispatch_subscription_checks(
    *,
    subscriptions: Sequence[Any],
    concurrency: int,
    dependencies: SubscriptionRunDispatchDependencies,
) -> None:
    scan_semaphore = asyncio.Semaphore(concurrency)

    async def bounded_subscription(sub: Any) -> None:
        async with scan_semaphore:
            await dependencies.process_subscription(sub)

    if subscriptions:
        await asyncio.gather(
            *(bounded_subscription(sub) for sub in subscriptions)
        )
