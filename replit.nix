{pkgs}: {
  deps = [
    pkgs.git
    pkgs.nodejs
    pkgs.wkhtmltopdf
    pkgs.postgresql
  ];
}
