import hashlib
import csv

def sha256(file_path, chunk_size=8192):
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            sha256.update(chunk)

    return sha256.hexdigest()

def load_csv(path):
    list_read = []
    with open(path, mode="r", newline="") as file:
        csv_reader = csv.reader(file)
        for row in csv_reader:
            list_read.append(row)

    return list_read