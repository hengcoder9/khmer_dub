"""Edge-TTS batch synthesis: 4–6 concurrent requests with retries."""
import asyncio
import os


async def _one(item, sem, job, done, total):
    import edge_tts

    async with sem:
        last = None
        for attempt in range(4):
            job.check()
            try:
                tmp = item["out"] + ".part"
                comm = edge_tts.Communicate(item["text"], item["voice"], rate=item.get("rate", "+0%"), pitch=item.get("pitch", "+0Hz"), volume=item.get("volume", "+0%"))
                await comm.save(tmp)
                if os.path.getsize(tmp) < 200:
                    raise RuntimeError("empty audio returned")
                os.replace(tmp, item["out"])
                done[0] += 1
                job.update(100 * done[0] / total, f"Edge-TTS {done[0]}/{total}")
                return {"id": item["id"], "ok": True}
            except Exception as e:  # noqa: BLE001
                last = e
                await asyncio.sleep(1.5 * (attempt + 1))
        done[0] += 1
        return {"id": item["id"], "ok": False, "error": f"{type(last).__name__}: {last}"}


def synth_batch(p, job):
    items = p["items"]
    for it in items:
        os.makedirs(os.path.dirname(it["out"]), exist_ok=True)
    sem = asyncio.Semaphore(max(1, min(10, int(p.get("concurrency", 8)))))
    done = [0]

    async def main():
        return await asyncio.gather(*[_one(it, sem, job, done, len(items)) for it in items])

    return {"results": asyncio.run(main())}
