# -- coding: utf-8 --

import asyncio
import websockets
import json
import base64
import time
from typing import Optional, Callable, Dict, Any
from enum import Enum


class SessionMode(Enum):
    SERVER_COMMIT = "server_commit"
    COMMIT = "commit"


class TTSRealtimeClient:
    """
    Client for interacting with TTS Realtime API.

    This class provides methods to connect to the TTS Realtime API, send text data, receive audio output, and manage WebSocket connections.

    Attributes:
        base_url (str):
            Base URL for the Realtime API.
        api_key (str):
            API Key for authentication.
        voice (str):
            Voice used by the server for speech synthesis.
        mode (SessionMode):
            Session mode, either server_commit or commit.
        audio_callback (Callable[[bytes], None]):
            Callback function to receive audio data.
        language_type(str)
            Language for synthesized speech. Options: Chinese, English, German, Italian, Portuguese, Spanish, Japanese, Korean, French, Russian, Auto
    """

    def __init__(
            self,
            base_url: str,
            api_key: str,
            voice: str = "Cherry",
            mode: SessionMode = SessionMode.SERVER_COMMIT,
            audio_callback: Optional[Callable[[bytes], None]] = None,
        language_type: str = "Auto"):
        self.base_url = base_url
        self.api_key = api_key
        self.voice = voice
        self.mode = mode
        self.ws = None
        self.audio_callback = audio_callback
        self.language_type = language_type

        # Current response status
        self._current_response_id = None
        self._current_item_id = None
        self._is_responding = False
        self._response_done_future = None


    async def connect(self) -> None:
        """Establish WebSocket connection with TTS Realtime API."""
        headers = {
            "Authorization": f"Bearer {self.api_key}"
        }

        self.ws = await websockets.connect(self.base_url, additional_headers=headers)

        # Set default session configuration
        await self.update_session({
            "mode": self.mode.value,
            "voice": self.voice,
            # Uncomment the lines below and replace model with qwen3-tts-instruct-flash-realtime in server_commit.py or commit.py to use instruction control
            # "instructions": "Speak quickly with a noticeably rising intonation, suitable for introducing fashion products.",
            # "optimize_instructions": true
            "language_type": self.language_type,
            "response_format": "pcm",
            "sample_rate": 24000
        })


    async def send_event(self, event) -> None:
        """Send event to server."""
        event['event_id'] = "event_" + str(int(time.time() * 1000))
        print(f"Sending event: type={event['type']}, event_id={event['event_id']}")
        await self.ws.send(json.dumps(event))


    async def update_session(self, config: Dict[str, Any]) -> None:
        """Update session configuration."""
        event = {
            "type": "session.update",
            "session": config
        }
        print("Updating session configuration: ", event)
        await self.send_event(event)


    async def append_text(self, text: str) -> None:
        """Send text data to API."""
        event = {
            "type": "input_text_buffer.append",
            "text": text
        }
        await self.send_event(event)


    async def commit_text_buffer(self) -> None:
        """Submit text buffer to trigger processing."""
        event = {
            "type": "input_text_buffer.commit"
        }
        await self.send_event(event)


    async def clear_text_buffer(self) -> None:
        """Clear text buffer."""
        event = {
            "type": "input_text_buffer.clear"
        }
        await self.send_event(event)


    async def finish_session(self) -> None:
        """End session."""
        event = {
            "type": "session.finish"
        }
        await self.send_event(event)


    async def wait_for_response_done(self):
        """Wait for response.done event"""
        if self._response_done_future:
            await self._response_done_future


    async def handle_messages(self) -> None:
        """Handle messages from server."""
        try:
            async for message in self.ws:
                event = json.loads(message)
                event_type = event.get("type")

                if event_type != "response.audio.delta":
                    print(f"Received event: {event_type}")

                if event_type == "error":
                    print("Error: ", event.get('error', {}))
                    continue
                elif event_type == "session.created":
                    print("Session created, ID: ", event.get('session', {}).get('id'))
                elif event_type == "session.updated":
                    print("Session updated, ID: ", event.get('session', {}).get('id'))
                elif event_type == "input_text_buffer.committed":
                    print("Text buffer committed, item ID: ", event.get('item_id'))
                elif event_type == "input_text_buffer.cleared":
                    print("Text buffer cleared")
                elif event_type == "response.created":
                    self._current_response_id = event.get("response", {}).get("id")
                    self._is_responding = True
                    # Create new future to wait for response.done
                    self._response_done_future = asyncio.Future()
                    print("Response created, ID: ", self._current_response_id)
                elif event_type == "response.output_item.added":
                    self._current_item_id = event.get("item", {}).get("id")
                    print("Output item added, ID: ", self._current_item_id)
                # Handle audio delta
                elif event_type == "response.audio.delta" and self.audio_callback:
                    audio_bytes = base64.b64decode(event.get("delta", ""))
                    self.audio_callback(audio_bytes)
                elif event_type == "response.audio.done":
                    print("Audio generation completed")
                elif event_type == "response.done":
                    self._is_responding = False
                    self._current_response_id = None
                    self._current_item_id = None
                    # Mark future as complete
                    if self._response_done_future and not self._response_done_future.done():
                        self._response_done_future.set_result(True)
                    print("Response completed")
                elif event_type == "session.finished":
                    print("Session ended")

        except websockets.exceptions.ConnectionClosed:
            print("Connection closed")
        except Exception as e:
            print("Error handling messages: ", str(e))


    async def close(self) -> None:
        """Close WebSocket connection."""
        if self.ws:
            await self.ws.close()