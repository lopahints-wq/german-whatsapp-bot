import os
import requests
from flask import Flask, request

app = Flask(__name__)

VERIFY_TOKEN = os.getenv("VERIFY_TOKEN", "change-this-token")
WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN", "")
PHONE_NUMBER_ID = os.getenv("PHONE_NUMBER_ID", "")
GRAPH_API_VERSION = os.getenv("GRAPH_API_VERSION", "v21.0")


def send_whatsapp_message(to, message):
    url = (
        f"https://graph.facebook.com/"
        f"{GRAPH_API_VERSION}/{PHONE_NUMBER_ID}/messages"
    )

    headers = {
        "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        "Content-Type": "application/json"
    }

    data = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {
            "body": message
        }
    }

    response = requests.post(url, headers=headers, json=data)
    print(response.text)


@app.route("/webhook", methods=["GET"])
def verify_webhook():
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    if mode == "subscribe" and token == VERIFY_TOKEN:
        return challenge, 200

    return "Verification failed", 403


@app.route("/webhook", methods=["POST"])
def receive_message():
    data = request.get_json()

    try:
        message = data["entry"][0]["changes"][0]["value"]["messages"][0]

        if message["type"] == "text":
            sender = message["from"]
            text = message["text"]["body"]

            reply = (
                "🇩🇪 Deutsch B1\n\n"
                f"Du hast geschrieben:\n{text}\n\n"
                "Dein B1-Lernbot ist aktiv! 🤖📚"
            )

            send_whatsapp_message(sender, reply)

    except (KeyError, IndexError, TypeError):
        pass

    return "OK", 200


@app.route("/")
def home():
    return "German WhatsApp Bot is running! 🇩🇪🤖"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
