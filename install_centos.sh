#bin/bash
sudo yum -y  groupinstall 'Development Tools'
git clone https://github.com/mark-sch/RedGekko.git
sudo yum -y install python2 sqlite
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.2/install.sh | bash
source ~/.bashrc
nvm install 12.12
npm install
npm install tulind
sqlite3 bot.db < bot.sql
