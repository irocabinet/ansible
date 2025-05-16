# Ansible Web

## Docker
```
docker run -d \
  --name ansible \
  -p 5000:5000 \
  -e ANSIBLE_HOST_KEY_CHECKING=False \
  -e ADMIN_USERNAME=admin123 \
  -e ADMIN_PASSWORD=admin123 \
  -v ./ansible:/app/db \
  ghcr.io/sky22333/ansible
```

![1](./.github/workflows/1.jpg)

---

![2](./.github/workflows/2.jpg)

---

![3](./.github/workflows/3.jpg)

---

![4](./.github/workflows/4.jpg)

---

![5](./.github/workflows/5.jpg)

---

![6](./.github/workflows/6.jpg)

---

![7](./.github/workflows/7.jpg)

---

![8](./.github/workflows/8.jpg)

