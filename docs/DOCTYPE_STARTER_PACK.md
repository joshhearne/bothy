# Starter doc types (seed data, Phase 6)

Vendor (company scope): Name, Type [dropdown: Vendor Types], Support Phone, Support URL, Account #, Notes (markdown)
ISP (location scope): Provider [dropdown: Internet Providers], Circuit Type [dropdown], Circuit ID, Static IPs, Gateway, Speed Down/Up, Account #, Support Notes (markdown)
Firewall (location): Make [dropdown: Firewall Vendors], Model, Serial, Firmware, LAN IP, WAN [doc_link: ISP], Admin URL, Credentials [secret_ref], Notes
Switch (location): Make, Model, Serial, Mgmt IP, VLANs (markdown), Uplinks (markdown)
Wi-Fi (location): SSID, Security [dropdown], VLAN, Controller/AP Model, Credentials [secret_ref]
Printer (location): Make, Model, IP, Serial, Driver URL, Supplies Vendor [doc_link: Vendor]
Server (location): Hostname, Role [multi_dropdown], OS [dropdown], IP, Host/Hypervisor, Backup Notes (markdown)
Domain/DNS (company): Domain, Registrar [dropdown: Registrars and DNS Hosts], DNS Host [dropdown: Registrars and DNS Hosts], Expiration (date), Records Notes (markdown)
M365/Google Tenant (company): Tenant Name, Tenant ID, Admin URL, Licenses (markdown), Break-glass [secret_ref]
